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
from services.google_workspace.drive_folders import move_file_to_folder
from services.google_workspace.forms_rendering.builder import (
    build_intro_requests,
    build_question_request,
)
from utils.timing import log_span

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

    # Verified grounding citations travel into the form description so the
    # exported deliverable carries the same sources shown in the chat preview.
    sources = quiz_payload.get("sources") or []
    if isinstance(sources, list) and sources:
        source_lines = []
        for source in sources[:10]:
            if not isinstance(source, dict):
                continue
            label = str(source.get("file_title") or source.get("title") or "").strip()
            url = str(source.get("url") or "").strip()
            if label or url:
                source_lines.append(f"• [{source.get('source_type', 'web')}] {label}{f' — {url}' if url else ''}")
        if source_lines:
            description = (description + "\n\nSources:\n" + "\n".join(source_lines)).strip()
    # Forms API rejects info.description beyond 4096 chars — never let sources
    # (or an unusually long model description) fail the whole export.
    if len(description) > 4000:
        description = description[:4000].rstrip() + "…"

    forms = _build_forms_service(uid)
    drive = _build_drive_service(uid)

    try:
        # Create empty form (the Forms API cannot parent into a folder, so the
        # Drive move below stays; the create already sets the final title, so
        # no rename is needed).
        with log_span(logger, "form_create", title=form_title[:40]):
            form = forms.forms().create(
                body={"info": {"title": form_title, "documentTitle": form_title}}
            ).execute()
            form_id = form["formId"]

        # Quiz settings, description, overview blocks and questions all travel
        # in a single batchUpdate — settings requests first, then items.
        requests: list[dict[str, Any]] = [
            {
                "updateSettings": {
                    "settings": {"quizSettings": {"isQuiz": True}},
                    "updateMask": "quizSettings",
                }
            }
        ]
        if description:
            requests.append(
                {
                    "updateFormInfo": {
                        "info": {"description": description},
                        "updateMask": "description",
                    }
                }
            )
        intro_requests = build_intro_requests(quiz_payload)
        question_requests = [
            build_question_request(q, index + len(intro_requests))
            for index, q in enumerate(questions)
        ]
        requests += intro_requests + question_requests

        with log_span(logger, "form_content", requests=len(requests)):
            forms.forms().batchUpdate(
                formId=form_id,
                body={"requests": requests},
            ).execute()

        with log_span(logger, "form_finalize"):
            if lecturer_email:
                drive.permissions().create(
                    fileId=form_id,
                    body={
                        "type": "user",
                        "role": "writer",
                        "emailAddress": lecturer_email,
                    },
                    sendNotificationEmail=False,
                ).execute()
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
