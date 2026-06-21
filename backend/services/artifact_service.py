"""Artifact service for tracking agent-generated content.

Handles versioned saving of lesson plans, labs, and quizzes to Firestore.
Matches the schema and versioning logic of Pnai-ai's firebase module.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from utils.firestore_client import get_firestore
from services.google_workspace.credentials import assert_google_oauth_valid
from services.google_workspace.docs_service import create_lesson_plan_doc_for_user
from services.google_workspace.drive_folders import (
    build_artifact_file_name,
    delete_drive_file,
    ensure_batch_artifact_folders,
)

logger = logging.getLogger(__name__)

BATCHES_COLLECTION = "batches"
ARTIFACTS_SUBCOLLECTION = "artifacts"
CHATS_SUBCOLLECTION = "chats"
MESSAGES_SUBCOLLECTION = "messages"


def _batch_ref(batch_id: str):
    return get_firestore().collection(BATCHES_COLLECTION).document(batch_id)


def _doc_to_dict(snapshot) -> dict[str, Any]:
    data = snapshot.to_dict() or {}
    data["id"] = snapshot.id
    return data


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _artifacts_col(batch_id: str):
    return _batch_ref(batch_id).collection(ARTIFACTS_SUBCOLLECTION)


def _batch_owned_by(batch_id: str, lecturer_id: str) -> bool:
    snap = _batch_ref(batch_id).get()
    return snap.exists and (snap.to_dict() or {}).get("lecturer_id") == lecturer_id


def _same_scope(data: dict[str, Any], artifact_type: str, week: int | None) -> bool:
    return (
        (data.get("type") or data.get("artifact_type")) == artifact_type
        and data.get("week") == week
    )


def save_artifact(batch_id: str, artifact_data: dict[str, Any]) -> str:
    """Save an artifact document and return its id."""
    artifact_id = artifact_data.get("id") or str(uuid.uuid4())
    created_at = artifact_data.get("created_at") or datetime.now(timezone.utc).isoformat()
    
    data = dict(artifact_data)
    data["id"] = artifact_id
    data["created_at"] = created_at

    doc_ref = (
        _batch_ref(batch_id)
        .collection(ARTIFACTS_SUBCOLLECTION)
        .document(artifact_id)
    )
    doc_ref.set(data)
    return artifact_id


def reserve_artifact(
    batch_id: str,
    artifact_type: str,
    week: int | None,
    title: str,
    created_by: str,
    batch_name: str = "",
    course_name: str = "",
) -> dict[str, Any]:
    """Reserve the next version before creating the Google file."""
    col = _artifacts_col(batch_id)
    existing = [
        _doc_to_dict(doc)
        for doc in col.stream()
        if _same_scope(doc.to_dict() or {}, artifact_type, week)
        and (doc.to_dict() or {}).get("status") == "confirmed"
        and (doc.to_dict() or {}).get("is_current", True)
    ]
    current = max(existing, key=lambda item: int(item.get("version") or 1), default=None)
    next_version = int((current or {}).get("version") or 0) + 1
    artifact_id = str(uuid.uuid4())
    data = {
        "id": artifact_id,
        "type": artifact_type,
        "artifact_type": artifact_type,
        "title": title,
        "batch_id": batch_id,
        "batch_name": batch_name,
        "course_name": course_name,
        "week": week,
        "version": next_version,
        "status": "creating",
        "is_current": False,
        "created_by": created_by,
        "created_at": _now(),
        "updated_at": _now(),
        "supersedes_artifact_id": current["id"] if current else "",
        "metadata": {},
    }
    col.document(artifact_id).set(data)
    return {
        "artifact_id": artifact_id,
        "version": next_version,
        "supersedes_artifact_id": data["supersedes_artifact_id"],
    }


def complete_artifact(
    batch_id: str,
    artifact_id: str,
    artifact_updates: dict[str, Any],
    make_current: bool = True,
) -> str:
    """Complete a previously reserved artifact."""
    col = _artifacts_col(batch_id)
    artifact_ref = col.document(artifact_id)
    snap = artifact_ref.get()
    if not snap.exists:
        raise RuntimeError(f"Reserved artifact {artifact_id} not found")
    reserved = snap.to_dict() or {}
    artifact_type = reserved.get("type") or reserved.get("artifact_type")
    week = reserved.get("week")

    if make_current:
        for doc in col.stream():
            data = doc.to_dict() or {}
            if (
                doc.id != artifact_id
                and _same_scope(data, artifact_type, week)
                and data.get("status") == "confirmed"
                and data.get("is_current", True)
            ):
                doc.reference.update(
                    {
                        "status": "superseded",
                        "is_current": False,
                        "superseded_by_artifact_id": artifact_id,
                        "updated_at": _now(),
                    }
                )

    updates = dict(artifact_updates)
    updates.update(
        {
            "status": "confirmed" if make_current else "draft",
            "is_current": bool(make_current),
            "updated_at": _now(),
        }
    )
    artifact_ref.update(updates)
    return artifact_id


def fail_reserved_artifact(batch_id: str, artifact_id: str, error: str) -> None:
    _artifacts_col(batch_id).document(artifact_id).update(
        {
            "status": "failed",
            "is_current": False,
            "error": str(error)[:1000],
            "updated_at": _now(),
        }
    )


def get_current_artifact(
    batch_id: str,
    artifact_type: str,
    week: int,
) -> dict[str, Any] | None:
    """Return the confirmed current artifact for batch/type/week."""
    col = _batch_ref(batch_id).collection(ARTIFACTS_SUBCOLLECTION)
    docs = list(col.stream())
    
    matches = [
        _doc_to_dict(doc)
        for doc in docs
        if (doc.to_dict() or {}).get("type") == artifact_type
        and (doc.to_dict() or {}).get("week") == week
        and (doc.to_dict() or {}).get("status") == "confirmed"
        and (doc.to_dict() or {}).get("is_current", True)
    ]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    return max(
        matches,
        key=lambda artifact: (
            int(artifact.get("version") or 1),
            str(artifact.get("created_at") or ""),
        ),
    )


def supersede_artifact(
    batch_id: str,
    artifact_id: str,
    new_artifact_id: str,
) -> None:
    """Mark an artifact as superseded by a newer version."""
    doc_ref = (
        _batch_ref(batch_id)
        .collection(ARTIFACTS_SUBCOLLECTION)
        .document(artifact_id)
    )
    if not doc_ref.get().exists:
        raise RuntimeError(f"Artifact {artifact_id} not found")
        
    doc_ref.update(
        {
            "status": "superseded",
            "is_current": False,
            "superseded_by_artifact_id": new_artifact_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )


def save_versioned_artifact(
    batch_id: str,
    artifact_data: dict[str, Any],
    replace_current: bool = True,
) -> str:
    """Save a week-scoped artifact with current-pointer versioning."""
    week = artifact_data.get("week")
    if week is None:
        return save_artifact(batch_id, artifact_data)

    artifact_type = artifact_data["type"]
    existing = get_current_artifact(batch_id, artifact_type, week)

    if existing is None:
        first = dict(artifact_data)
        first.update({
            "version": 1,
            "is_current": True,
            "status": "confirmed",
        })
        return save_artifact(batch_id, first)

    if not replace_current:
        draft = dict(artifact_data)
        draft.update({
            "is_current": False,
            "status": "draft",
        })
        return save_artifact(batch_id, draft)

    new_version = int(existing.get("version") or 1) + 1
    new_artifact_id = str(uuid.uuid4())
    updated = dict(artifact_data)
    updated.update({
        "id": new_artifact_id,
        "version": new_version,
        "is_current": True,
        "status": "confirmed",
        "supersedes_artifact_id": existing["id"],
    })
    
    saved_id = save_artifact(batch_id, updated)
    supersede_artifact(batch_id, str(existing["id"]), saved_id)
    return saved_id


# ---------------------------------------------------------------------------
# Specific Builders
# ---------------------------------------------------------------------------

def save_lesson_plan_artifact(
    batch_id: str,
    week: int,
    title: str,
    doc_url: str,
    doc_id: str,
    lecturer_email: str,
    batch_name: str = "",
    course_name: str = "",
) -> str:
    artifact_data = {
        "type": "lesson_plan",
        "artifact_type": "lesson_plan",
        "status": "confirmed",
        "title": title,
        "batch_id": batch_id,
        "batch_name": batch_name,
        "course_name": course_name,
        "doc_url": doc_url,
        "doc_id": doc_id,
        "week": week,
        "created_by": lecturer_email,
        "metadata": {},
    }
    return save_versioned_artifact(batch_id, artifact_data)


def save_lesson_plan_draft_from_session(
    batch_id: str,
    lecturer_id: str,
    chat_id: str,
    run_id: str,
    lesson_plan_payload: dict[str, Any],
    rendered_markdown: str = "",
    lecturer_email: str = "",
) -> dict[str, Any]:
    """Save or update a draft lesson-plan artifact produced by an Agent Engine run."""
    if not _batch_owned_by(batch_id, lecturer_id):
        raise RuntimeError("Batch not found or access denied")

    title = str(lesson_plan_payload.get("title") or "Untitled Lesson Plan").strip()
    week = lesson_plan_payload.get("week")
    try:
        week = int(week)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("lesson_plan_full.week is required for draft artifact save") from exc

    col = _artifacts_col(batch_id)
    existing = [
        _doc_to_dict(doc)
        for doc in col.where("source_run_id", "==", run_id).stream()
        if (doc.to_dict() or {}).get("artifact_type") == "lesson_plan"
    ]
    artifact_id = str(existing[0]["id"]) if existing else str(uuid.uuid4())
    now = _now()
    data = {
        "id": artifact_id,
        "type": "lesson_plan",
        "artifact_type": "lesson_plan",
        "status": "draft",
        "is_current": False,
        "version": None,
        "title": title,
        "batch_id": batch_id,
        "week": week,
        "content_json": lesson_plan_payload,
        "rendered_markdown": rendered_markdown,
        "source_run_id": run_id,
        "source_chat_id": chat_id,
        "created_by": lecturer_id,
        "created_by_email": lecturer_email,
        "updated_at": now,
        "metadata": {
            "source": "agent_platform_session",
            "exportable": True,
        },
    }
    if not existing:
        data["created_at"] = now
    col.document(artifact_id).set(data, merge=True)
    saved = col.document(artifact_id).get()
    return _doc_to_dict(saved)


def export_lesson_plan_draft_to_google_docs(
    batch_id: str,
    artifact_id: str,
    lecturer_id: str,
) -> dict[str, Any]:
    """Export a draft lesson-plan artifact to Google Docs and confirm it."""
    batch_snap = _batch_ref(batch_id).get()
    if not batch_snap.exists:
        raise RuntimeError("Batch not found")
    batch = batch_snap.to_dict() or {}
    if batch.get("lecturer_id") != lecturer_id:
        raise PermissionError("Batch not found or access denied")

    ref = _artifacts_col(batch_id).document(artifact_id)
    snap = ref.get()
    if not snap.exists:
        raise RuntimeError("Artifact not found")
    artifact = _doc_to_dict(snap)
    artifact_type = str(artifact.get("artifact_type") or artifact.get("type") or "")
    if artifact_type != "lesson_plan":
        raise RuntimeError("Artifact is not a lesson plan")
    if artifact.get("status") not in {"draft", "failed_export"}:
        raise RuntimeError("Only draft lesson plans can be exported")

    payload = artifact.get("content_json")
    if not isinstance(payload, dict) or not payload:
        raise RuntimeError("Draft lesson plan content is missing")

    assert_google_oauth_valid(lecturer_id, ["documents", "drive.file"])

    week = int(payload.get("week") or artifact.get("week") or 0)
    title = str(payload.get("title") or artifact.get("title") or "Lesson Plan")
    next_version = _next_confirmed_version(batch_id, "lesson_plan", week)
    folders = ensure_batch_artifact_folders(
        uid=lecturer_id,
        batch_id=batch_id,
        batch_name=str(batch.get("batch_name") or artifact.get("batch_name") or ""),
        course_name=str(batch.get("course_name") or artifact.get("course_name") or ""),
    )
    lesson_folder = (folders.get("drive_folders") or {}).get("lesson_plan") or {}
    folder_id = str(lesson_folder.get("id") or "")
    drive_file_name = build_artifact_file_name(
        version=next_version,
        week=week,
        artifact_type="lesson_plan",
        title=title,
    )

    ref.update(
        {
            "status": "exporting",
            "export_error": "",
            "updated_at": _now(),
        }
    )
    try:
        doc_result = create_lesson_plan_doc_for_user(
            uid=lecturer_id,
            lesson_plan_payload=payload,
            lecturer_email=str(batch.get("lecturer_email") or artifact.get("created_by_email") or ""),
            target_folder_id=folder_id,
            drive_file_name=drive_file_name,
        )
    except Exception as exc:
        safe_error = str(exc)[:1000]
        ref.update(
            {
                "status": "failed_export",
                "export_error": safe_error,
                "is_current": False,
                "updated_at": _now(),
            }
        )
        raise RuntimeError(safe_error) from exc

    _supersede_current_artifacts(batch_id, "lesson_plan", week, artifact_id)
    updates = {
        "status": "confirmed",
        "is_current": True,
        "version": next_version,
        "doc_url": doc_result.get("doc_url", ""),
        "doc_id": doc_result.get("doc_id", ""),
        "drive_file_name": doc_result.get("drive_file_name", drive_file_name),
        "drive_folder_id": doc_result.get("drive_folder_id", folder_id),
        "exported_at": _now(),
        "updated_at": _now(),
        "export_error": "",
    }
    ref.update(updates)
    _update_source_message_export_metadata(
        batch_id=batch_id,
        artifact=artifact,
        export_updates=updates,
    )
    saved = _doc_to_dict(ref.get())
    return {
        "artifact_id": artifact_id,
        "status": saved.get("status"),
        "version": saved.get("version"),
        "doc_url": saved.get("doc_url", ""),
        "doc_id": saved.get("doc_id", ""),
        "drive_file_name": saved.get("drive_file_name", ""),
    }


def _next_confirmed_version(batch_id: str, artifact_type: str, week: int | None) -> int:
    versions = [
        int((doc.to_dict() or {}).get("version") or 0)
        for doc in _artifacts_col(batch_id).stream()
        if _same_scope(doc.to_dict() or {}, artifact_type, week)
        and (doc.to_dict() or {}).get("status") == "confirmed"
    ]
    return max(versions, default=0) + 1


def _supersede_current_artifacts(
    batch_id: str,
    artifact_type: str,
    week: int | None,
    new_artifact_id: str,
) -> None:
    for doc in _artifacts_col(batch_id).stream():
        data = doc.to_dict() or {}
        if (
            doc.id != new_artifact_id
            and _same_scope(data, artifact_type, week)
            and data.get("status") == "confirmed"
            and data.get("is_current", True)
        ):
            doc.reference.update(
                {
                    "status": "superseded",
                    "is_current": False,
                    "superseded_by_artifact_id": new_artifact_id,
                    "updated_at": _now(),
                }
            )


def _update_source_message_export_metadata(
    batch_id: str,
    artifact: dict[str, Any],
    export_updates: dict[str, Any],
) -> None:
    chat_id = str(artifact.get("source_chat_id") or "")
    run_id = str(artifact.get("source_run_id") or "")
    if not chat_id or not run_id:
        return

    metadata = {
        "draft_artifact_id": str(artifact.get("id") or ""),
        "artifact_type": "lesson_plan",
        "week": artifact.get("week"),
        "exportable": False,
        "doc_url": export_updates.get("doc_url", ""),
        "doc_id": export_updates.get("doc_id", ""),
        "version": export_updates.get("version"),
        "drive_file_name": export_updates.get("drive_file_name", ""),
    }
    messages = (
        _batch_ref(batch_id)
        .collection(CHATS_SUBCOLLECTION)
        .document(chat_id)
        .collection(MESSAGES_SUBCOLLECTION)
        .where("run_id", "==", run_id)
        .where("role", "==", "assistant")
        .stream()
    )
    for message in messages:
        message.reference.update({"metadata": metadata, "updated_at": _now()})


def save_lab_artifact(
    batch_id: str,
    week: int,
    title: str,
    doc_url: str,
    doc_id: str,
    student_doc_url: str,
    student_doc_id: str,
    lecturer_email: str,
    batch_name: str = "",
    course_name: str = "",
) -> str:
    artifact_data = {
        "type": "lab",
        "artifact_type": "lab",
        "status": "confirmed",
        "title": title,
        "batch_id": batch_id,
        "batch_name": batch_name,
        "course_name": course_name,
        "doc_url": doc_url,
        "doc_id": doc_id,
        "week": week,
        "created_by": lecturer_email,
        "metadata": {
            "student_doc_url": student_doc_url,
            "student_doc_id": student_doc_id,
        },
    }
    return save_versioned_artifact(batch_id, artifact_data)


def save_quiz_artifact(
    batch_id: str,
    week: int,
    title: str,
    form_url: str,
    form_id: str,
    lecturer_email: str,
    batch_name: str = "",
    course_name: str = "",
) -> str:
    artifact_data = {
        "type": "quiz",
        "artifact_type": "quiz",
        "status": "confirmed",
        "title": title,
        "batch_id": batch_id,
        "batch_name": batch_name,
        "course_name": course_name,
        "doc_url": form_url,
        "doc_id": form_id,
        "form_url": form_url,
        "form_id": form_id,
        "week": week,
        "created_by": lecturer_email,
        "metadata": {
            "form_url": form_url,
            "form_id": form_id,
        },
    }
    return save_versioned_artifact(batch_id, artifact_data)


def list_artifacts(
    batch_id: str,
    lecturer_id: str,
    filters: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """List artifacts for a lecturer-owned batch."""
    if not _batch_owned_by(batch_id, lecturer_id):
        return []
    filters = filters or {}
    artifact_type = filters.get("type")
    week = filters.get("week")
    current = filters.get("current")
    status_filter = filters.get("status")

    items: list[dict[str, Any]] = []
    for doc in _artifacts_col(batch_id).stream():
        data = _doc_to_dict(doc)
        if artifact_type and (data.get("type") or data.get("artifact_type")) != artifact_type:
            continue
        if week is not None and data.get("week") != week:
            continue
        if current is not None and bool(data.get("is_current")) is not bool(current):
            continue
        if status_filter and data.get("status") != status_filter:
            continue
        items.append(data)

    return sorted(
        items,
        key=lambda item: (
            int(item.get("week") or 0),
            str(item.get("type") or item.get("artifact_type") or ""),
            int(item.get("version") or 0),
            str(item.get("created_at") or ""),
        ),
        reverse=True,
    )


def get_artifact(batch_id: str, artifact_id: str, lecturer_id: str) -> dict[str, Any] | None:
    if not _batch_owned_by(batch_id, lecturer_id):
        return None
    snap = _artifacts_col(batch_id).document(artifact_id).get()
    if not snap.exists:
        return None
    return _doc_to_dict(snap)


def artifact_summary(batch_id: str, lecturer_id: str) -> dict[str, Any] | None:
    batch_snap = _batch_ref(batch_id).get()
    if not batch_snap.exists:
        return None
    batch = batch_snap.to_dict() or {}
    if batch.get("lecturer_id") != lecturer_id:
        return None

    counts: dict[str, dict[str, int]] = {}
    by_week_map: dict[int, dict[str, Any]] = {}
    for item in list_artifacts(batch_id, lecturer_id):
        item_type = str(item.get("type") or item.get("artifact_type") or "other")
        bucket = counts.setdefault(item_type, {"current": 0, "total": 0})
        bucket["total"] += 1
        if item.get("is_current") and item.get("status") == "confirmed":
            bucket["current"] += 1

        week = item.get("week")
        if week is not None:
            row = by_week_map.setdefault(int(week), {"week": int(week), "artifacts": []})
            row["artifacts"].append(item)

    return {
        "drive_root_folder_id": batch.get("drive_root_folder_id", ""),
        "drive_root_folder_url": batch.get("drive_root_folder_url", ""),
        "counts": counts,
        "by_week": [by_week_map[key] for key in sorted(by_week_map)],
    }


def _drive_file_ids_for_artifact(artifact: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for key in ("doc_id", "form_id"):
        value = str(artifact.get(key) or "").strip()
        if value and value not in ids:
            ids.append(value)
    metadata = artifact.get("metadata") or {}
    for key in ("student_doc_id", "form_id"):
        value = str(metadata.get(key) or "").strip()
        if value and value not in ids:
            ids.append(value)
    for value in metadata.get("extra_file_ids") or []:
        file_id = str(value or "").strip()
        if file_id and file_id not in ids:
            ids.append(file_id)
    return ids


def _promote_latest_remaining(
    batch_id: str,
    artifact_type: str,
    week: int | None,
) -> str | None:
    remaining = [
        _doc_to_dict(doc)
        for doc in _artifacts_col(batch_id).stream()
        if _same_scope(doc.to_dict() or {}, artifact_type, week)
        and (doc.to_dict() or {}).get("status") in {"confirmed", "superseded"}
    ]
    if not remaining:
        return None
    latest = max(
        remaining,
        key=lambda item: (int(item.get("version") or 0), str(item.get("created_at") or "")),
    )
    _artifacts_col(batch_id).document(latest["id"]).update(
        {
            "status": "confirmed",
            "is_current": True,
            "updated_at": _now(),
        }
    )
    return str(latest["id"])


def delete_artifact(
    batch_id: str,
    artifact_id: str,
    lecturer_id: str,
    delete_google: bool = True,
) -> dict[str, Any] | None:
    """Delete one artifact record and optionally its Google Drive file(s)."""
    if not _batch_owned_by(batch_id, lecturer_id):
        return None

    col = _artifacts_col(batch_id)
    artifact_ref = col.document(artifact_id)
    snap = artifact_ref.get()
    if not snap.exists:
        return None

    artifact = _doc_to_dict(snap)
    file_ids = _drive_file_ids_for_artifact(artifact)
    deleted_ids: list[str] = []
    already_missing_ids: list[str] = []
    errors: list[str] = []
    if delete_google:
        for file_id in file_ids:
            try:
                deleted = delete_drive_file(uid=lecturer_id, file_id=file_id)
                (deleted_ids if deleted else already_missing_ids).append(file_id)
            except Exception as exc:
                errors.append(f"{file_id}: {exc}")
    if errors:
        raise RuntimeError("; ".join(errors))

    deletion_id = str(uuid.uuid4())
    _batch_ref(batch_id).collection("artifact_deletions").document(deletion_id).set(
        {
            "artifact_id": artifact_id,
            "deleted_artifact_snapshot": artifact,
            "deleted_drive_file_ids": deleted_ids,
            "already_missing_drive_file_ids": already_missing_ids,
            "delete_google": delete_google,
            "deleted_by": lecturer_id,
            "deleted_at": _now(),
        }
    )

    was_current = bool(artifact.get("is_current"))
    artifact_type = str(artifact.get("type") or artifact.get("artifact_type") or "")
    week = artifact.get("week")
    artifact_ref.delete()
    promoted_id = _promote_latest_remaining(batch_id, artifact_type, week) if was_current else None

    return {
        "artifact_id": artifact_id,
        "deleted_drive_file_ids": deleted_ids,
        "already_missing_drive_file_ids": already_missing_ids,
        "delete_google": delete_google,
        "promoted_artifact_id": promoted_id,
        "deletion_id": deletion_id,
    }
