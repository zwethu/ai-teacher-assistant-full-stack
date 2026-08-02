"""Google Drive folder organization for generated PNAI artifacts."""

from __future__ import annotations

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from services.google_workspace.credentials import build_user_credentials
from utils.firestore_client import get_firestore
from utils.timing import log_span

FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
BATCHES_COLLECTION = "batches"
logger = logging.getLogger(__name__)

SUBFOLDER_NAMES = {
    "lesson_plan": "Lesson Plans",
    "lab": "Labs",
    "assessment": "Assessments",
    "quiz": "Assessments",
    "email": "Emails",
    "other": "Other",
}

FOLDER_KEYS = ("lesson_plan", "lab", "assessment", "email", "other")

LAB_SUBFOLDER_NAMES = {
    "lab_lecturer": "Lecturer Guides",
    "lab_student": "Student Instructions",
}


def sanitize_drive_name(name: str) -> str:
    """Return a compact Drive-safe display name."""
    cleaned = re.sub(r"[\r\n\t]+", " ", str(name or ""))
    cleaned = re.sub(r"[\\/]+", "-", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:180] or "Untitled"


def build_batch_root_folder_name(batch_name: str, course_name: str = "") -> str:
    del course_name
    return sanitize_drive_name(f"PNAI - {batch_name or 'Batch'}")


def rename_batch_root_folder(uid: str, folder_id: str, batch_name: str) -> None:
    """Rename the batch's Drive root folder to match a new batch name."""
    drive = _build_drive_service(uid)
    drive.files().update(
        fileId=folder_id,
        body={"name": build_batch_root_folder_name(batch_name)},
        fields="id",
    ).execute()


def folder_url(folder_id: str) -> str:
    return f"https://drive.google.com/drive/folders/{folder_id}"


def build_artifact_file_name(
    version: int,
    week: int | None,
    artifact_type: str,
    title: str,
    suffix: str = "",
) -> str:
    version_part = f"v{int(version or 1):02d}"
    week_part = f"Week {int(week or 0):02d}" if week is not None else "No Week"
    normalized_type = artifact_type if artifact_type != "assessment" else "quiz"
    label = {
        "lesson_plan": "Lesson Plan",
        "lab": "Lab",
        "quiz": "Assessment",
        "assessment": "Assessment",
        "email": "Email",
    }.get(normalized_type, "Artifact")
    pieces = [version_part, week_part, label, sanitize_drive_name(title or label)]
    if suffix:
        pieces.append(sanitize_drive_name(suffix))
    return sanitize_drive_name(" - ".join(pieces))


def _build_drive_service(uid: str):
    creds = build_user_credentials(uid, ["drive.file"])
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _quote_query_value(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


def _folder_result(raw: dict[str, Any], fallback_name: str) -> dict[str, str]:
    folder_id = str(raw.get("id") or "")
    name = str(raw.get("name") or fallback_name)
    return {
        "id": folder_id,
        "name": name,
        "url": str(raw.get("webViewLink") or folder_url(folder_id)),
    }


def get_or_create_folder(uid: str, name: str, parent_id: str | None = None) -> dict[str, str]:
    drive = _build_drive_service(uid)
    clean_name = sanitize_drive_name(name)
    query_parts = [
        f"mimeType='{FOLDER_MIME_TYPE}'",
        f"name='{_quote_query_value(clean_name)}'",
        "trashed=false",
    ]
    if parent_id:
        query_parts.append(f"'{_quote_query_value(parent_id)}' in parents")

    found = drive.files().list(
        q=" and ".join(query_parts),
        fields="files(id,name,webViewLink)",
        spaces="drive",
        pageSize=1,
    ).execute()
    files = found.get("files") or []
    if files:
        return _folder_result(files[0], clean_name)

    body: dict[str, Any] = {"name": clean_name, "mimeType": FOLDER_MIME_TYPE}
    if parent_id:
        body["parents"] = [parent_id]
    created = drive.files().create(
        body=body,
        fields="id,name,webViewLink",
    ).execute()
    return _folder_result(created, clean_name)


def _valid_folder(uid: str, folder_id: str) -> dict[str, str] | None:
    if not folder_id:
        return None
    drive = _build_drive_service(uid)
    try:
        data = drive.files().get(
            fileId=folder_id,
            fields="id,name,webViewLink,trashed",
        ).execute()
    except HttpError as exc:
        if getattr(exc.resp, "status", None) == 404:
            return None
        raise
    if data.get("trashed"):
        return None
    return _folder_result(data, str(data.get("name") or "Folder"))


def ensure_batch_artifact_folders(
    uid: str,
    batch_id: str,
    batch_name: str,
    course_name: str = "",
) -> dict[str, Any]:
    with log_span(logger, "ensure_batch_artifact_folders", batch_id=batch_id):
        return _ensure_batch_artifact_folders(uid, batch_id, batch_name, course_name)


def _ensure_batch_artifact_folders(
    uid: str,
    batch_id: str,
    batch_name: str,
    course_name: str,
) -> dict[str, Any]:
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    data = batch_ref.get().to_dict() or {}
    stored_folders = data.get("drive_folders") or {}

    # Each validation/create is one Drive round-trip; none depend on each other
    # except that creating a missing subfolder needs its parent's id. So: check
    # everything concurrently, then create only the gaps (also concurrently).
    # Every worker builds its own Drive service — googleapiclient services are
    # not thread-safe — but the OAuth credentials underneath come from the
    # process-level cache, so a service build costs no network round-trip.
    check_keys = list(FOLDER_KEYS) + list(LAB_SUBFOLDER_NAMES)
    with ThreadPoolExecutor(max_workers=len(check_keys) + 1) as pool:
        root_check = pool.submit(
            _valid_folder, uid, str(data.get("drive_root_folder_id") or "")
        )
        checks = {
            key: pool.submit(
                _valid_folder, uid, str((stored_folders.get(key) or {}).get("id") or "")
            )
            for key in check_keys
        }

        root = root_check.result()
        if root is None:
            root = get_or_create_folder(
                uid,
                build_batch_root_folder_name(batch_name, course_name),
            )

        folders: dict[str, dict[str, str]] = {}
        creates: dict[str, Any] = {}
        for key in FOLDER_KEYS:
            folder = checks[key].result()
            if folder is None:
                creates[key] = pool.submit(
                    get_or_create_folder, uid, SUBFOLDER_NAMES[key], root["id"]
                )
            else:
                folders[key] = folder
        for key, future in creates.items():
            folders[key] = future.result()

        lab_root_id = str((folders.get("lab") or {}).get("id") or "")
        if lab_root_id:
            lab_creates: dict[str, Any] = {}
            for key, name in LAB_SUBFOLDER_NAMES.items():
                try:
                    folder = checks[key].result()
                except Exception as exc:
                    logger.warning(
                        "Failed to ensure nested lab folder key=%s batch_id=%s; using Labs fallback: %s",
                        key,
                        batch_id,
                        exc,
                    )
                    continue
                if folder is None:
                    lab_creates[key] = pool.submit(
                        get_or_create_folder, uid, name, lab_root_id
                    )
                else:
                    folders[key] = folder
            for key, future in lab_creates.items():
                try:
                    folders[key] = future.result()
                except Exception as exc:
                    logger.warning(
                        "Failed to ensure nested lab folder key=%s batch_id=%s; using Labs fallback: %s",
                        key,
                        batch_id,
                        exc,
                    )

    update = {
        "drive_root_folder_id": root["id"],
        "drive_root_folder_url": root["url"],
        "drive_folders": folders,
    }
    batch_ref.update(update)
    return update


def move_file_to_folder(uid: str, file_id: str, folder_id: str) -> None:
    if not file_id or not folder_id:
        return
    drive = _build_drive_service(uid)
    file_data = drive.files().get(fileId=file_id, fields="parents").execute()
    parents = file_data.get("parents") or []
    kwargs: dict[str, Any] = {
        "fileId": file_id,
        "addParents": folder_id,
        "fields": "id,parents",
    }
    if parents:
        kwargs["removeParents"] = ",".join(parents)
    drive.files().update(**kwargs).execute()


def rename_file(uid: str, file_id: str, name: str) -> None:
    if not file_id or not name:
        return
    drive = _build_drive_service(uid)
    drive.files().update(
        fileId=file_id,
        body={"name": sanitize_drive_name(name)},
        fields="id,name",
    ).execute()


def get_drive_file_metadata(uid: str, file_id: str) -> dict[str, Any]:
    """Return Drive metadata used to detect user edits to Google editor files."""
    if not file_id:
        raise ValueError("file_id is required")
    drive = _build_drive_service(uid)
    return drive.files().get(
        fileId=file_id,
        fields="id,name,mimeType,modifiedTime,version,webViewLink,trashed",
    ).execute()


def delete_drive_file(uid: str, file_id: str) -> bool:
    if not file_id:
        return False
    drive = _build_drive_service(uid)
    try:
        drive.files().delete(fileId=file_id).execute()
        return True
    except HttpError as exc:
        if getattr(exc.resp, "status", None) == 404:
            return False
        raise


def upload_text_file(
    uid: str,
    *,
    name: str,
    content: str,
    parent_id: str,
    mime_type: str = "text/plain",
) -> dict[str, str]:
    """Create or update a small text file (lab resources) in a Drive folder.

    Upsert by name: a re-export must replace the folder's copy of each file,
    not add a same-named duplicate next to it — resource files carry stable
    names (docs dodge this with versioned names, resources cannot).
    """
    from googleapiclient.http import MediaInMemoryUpload

    drive = _build_drive_service(uid)
    clean_name = sanitize_drive_name(name)
    media = MediaInMemoryUpload(content.encode("utf-8"), mimetype=mime_type)

    existing = drive.files().list(
        q=(
            f"name='{_quote_query_value(clean_name)}' and "
            f"'{_quote_query_value(parent_id)}' in parents and trashed=false"
        ),
        fields="files(id)",
        spaces="drive",
        pageSize=1,
    ).execute().get("files") or []
    if existing:
        updated = drive.files().update(
            fileId=existing[0]["id"],
            media_body=media,
            fields="id,name,webViewLink",
        ).execute()
        return {
            "id": str(updated.get("id") or ""),
            "name": str(updated.get("name") or clean_name),
            "url": str(updated.get("webViewLink") or ""),
        }

    created = drive.files().create(
        body={"name": clean_name, "parents": [parent_id]},
        media_body=media,
        fields="id,name,webViewLink",
    ).execute()
    return {
        "id": str(created.get("id") or ""),
        "name": str(created.get("name") or clean_name),
        "url": str(created.get("webViewLink") or ""),
    }


def upload_lab_starter_files(
    uid: str,
    *,
    starter_files: list[dict],
    student_parent_id: str,
    lecturer_parent_id: str,
) -> dict[str, str]:
    """Materialize the lab scaffold as real Drive files.

    Each week folder gets a "Resources" subfolder so the doc stays visually
    on top and the files don't crowd it. The student Resources folder gets
    starter + data files; the lecturer Resources folder gets EVERYTHING —
    the same starter/data files plus the solutions (lecturers need to run
    the scaffold too, not just read answers). Drive has no nested paths, so
    file paths are flattened with '__'. Returns folder links; never raises
    (file delivery must not fail the doc export).
    """
    result: dict[str, str] = {}
    try:
        student_files = [
            f for f in starter_files
            if str(f.get("file_role") or "starter") != "solution" and str(f.get("content") or "").strip()
        ]
        solution_files = [
            f for f in starter_files
            if str(f.get("file_role") or "") == "solution" and str(f.get("content") or "").strip()
        ]
        if not student_files and not solution_files:
            return result

        with log_span(
            logger,
            "upload_lab_starter_files",
            files=len(student_files) + len(solution_files),
        ), ThreadPoolExecutor(max_workers=8) as pool:
            # The two Resources folders are independent; the file uploads
            # within each are too. upload_text_file builds its own Drive
            # service, so every future is thread-safe.
            student_folder_future = (
                pool.submit(get_or_create_folder, uid, "Resources", student_parent_id)
                if student_files and student_parent_id
                else None
            )
            lecturer_folder_future = (
                pool.submit(get_or_create_folder, uid, "Resources", lecturer_parent_id)
                if (student_files or solution_files) and lecturer_parent_id
                else None
            )

            def _upload_all(files: list[dict], parent_id: str) -> list:
                return [
                    pool.submit(
                        upload_text_file,
                        uid,
                        name=str(f.get("path") or "file.txt").replace("/", "__"),
                        content=str(f.get("content") or ""),
                        parent_id=parent_id,
                    )
                    for f in files
                ]

            uploads = []
            if student_folder_future is not None:
                folder = student_folder_future.result()
                uploads += _upload_all(student_files, folder["id"])
                result["lab_files_folder_id"] = folder["id"]
                result["lab_files_folder_url"] = folder.get("url") or folder_url(folder["id"])
            if lecturer_folder_future is not None:
                folder = lecturer_folder_future.result()
                uploads += _upload_all(student_files + solution_files, folder["id"])
                result["lab_solutions_folder_id"] = folder["id"]
                result["lab_solutions_folder_url"] = folder.get("url") or folder_url(folder["id"])
            for upload in uploads:
                upload.result()
    except Exception:  # pragma: no cover - defensive: delivery is best-effort
        logger.warning("lab starter-file upload failed", exc_info=True)
        result["lab_files_upload_error"] = "Starter file upload failed — files are in the doc."
    return result
