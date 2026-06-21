"""Google Forms service — creates quiz forms for users.

Uses user OAuth credentials to create forms in the user's own Drive.
We use the googleapiclient here instead of raw requests to ensure we use
the refreshed credentials correctly.
"""

from __future__ import annotations

import logging
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from services.google_workspace.credentials import build_user_credentials
from services.google_workspace.drive_folders import move_file_to_folder, rename_file
from services.google_workspace.forms_rendering.builder import build_question_request

logger = logging.getLogger(__name__)


def _build_forms_service(uid: str):
    creds = build_user_credentials(uid, ["forms.body"])
    return build("forms", "v1", credentials=creds, cache_discovery=False)


def _build_drive_service(uid: str):
    creds = build_user_credentials(uid, ["drive.file"])
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def create_quiz_form_for_user(
    uid: str,
    quiz_payload: dict[str, Any],
    lecturer_email: str,
    target_folder_id: str | None = None,
    drive_file_name: str | None = None,
) -> dict[str, str]:
    """Create a Google Form as a quiz for the user.

    Returns ``{"form_url": "...", "form_id": "...", "title": "..."}``.
    """
    title = quiz_payload.get("title", "Quiz")
    form_title = drive_file_name or title
    description = quiz_payload.get("description", "")
    questions = quiz_payload.get("questions", [])

    forms = _build_forms_service(uid)
    drive = _build_drive_service(uid)

    try:
        # Create empty form
        form = forms.forms().create(
            body={"info": {"title": form_title, "documentTitle": form_title}}
        ).execute()
        form_id = form["formId"]

        # Enable quiz mode and set description
        settings_requests: list[dict[str, Any]] = [
            {
                "updateSettings": {
                    "settings": {"quizSettings": {"isQuiz": True}},
                    "updateMask": "quizSettings",
                }
            }
        ]
        if description:
            settings_requests.append(
                {
                    "updateFormInfo": {
                        "info": {"description": description},
                        "updateMask": "description",
                    }
                }
            )

        forms.forms().batchUpdate(
            formId=form_id,
            body={"requests": settings_requests},
        ).execute()

        # Add questions
        question_requests = [
            build_question_request(q, index)
            for index, q in enumerate(questions)
        ]
        if question_requests:
            forms.forms().batchUpdate(
                formId=form_id,
                body={"requests": question_requests},
            ).execute()

        # Share with teacher
        drive.permissions().create(
            fileId=form_id,
            body={
                "type": "user",
                "role": "writer",
                "emailAddress": lecturer_email,
            },
            sendNotificationEmail=False,
        ).execute()
        if drive_file_name:
            rename_file(uid, form_id, drive_file_name)
        if target_folder_id:
            move_file_to_folder(uid, form_id, target_folder_id)

    except HttpError as exc:
        logger.exception("Google Forms API error for uid=%s title=%r", uid, title)
        raise RuntimeError(
            f"Failed to create quiz form '{title}': {exc}"
        ) from exc

    form_url = f"https://docs.google.com/forms/d/{form_id}/edit"
    logger.info("created quiz form uid=%s url=%s", uid, form_url)
    return {
        "form_url": form_url,
        "form_id": form_id,
        "title": title,
        "drive_file_name": drive_file_name or form_title,
        "drive_folder_id": target_folder_id or "",
    }
