"""Artifact service for tracking agent-generated content.

Handles versioned saving of lesson plans, labs, and quizzes to Firestore.
Matches the schema and versioning logic of Pnai-ai's firebase module.
"""

from __future__ import annotations

import logging
import hashlib
import json
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from utils.timing import log_span

from utils.firestore_client import get_firestore
from services.google_workspace.credentials import assert_google_oauth_valid
from services.google_workspace.docs_service import (
    create_lab_docs_for_user,
    create_lesson_plan_doc_for_user,
)
from services.google_workspace.drive_folders import (
    build_artifact_file_name,
    delete_drive_file,
    ensure_batch_artifact_folders,
    get_drive_file_metadata,
    get_or_create_folder,
)
from services.google_workspace.forms_service import create_quiz_form_for_user
from services.artifact_export_validation import (
    ArtifactExportCoverageError,
    validate_export_coverage,
)
from services.artifact_renderers.game_markdown import (
    RENDERER_VERSION as GAME_MARKDOWN_RENDERER_VERSION,
    render_game_markdown,
)
from services.artifact_renderers.lab_markdown import (
    RENDERER_VERSION as LAB_MARKDOWN_RENDERER_VERSION,
    render_lab_markdown,
)
from services.artifact_renderers.lesson_plan_markdown import (
    RENDERER_VERSION as LESSON_PLAN_MARKDOWN_RENDERER_VERSION,
    render_lesson_plan_markdown,
)
from services.artifact_renderers.quiz_markdown import (
    RENDERER_VERSION as QUIZ_MARKDOWN_RENDERER_VERSION,
    render_quiz_markdown,
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


def _canonical_content_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _content_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_content_json(payload).encode("utf-8")).hexdigest()


def content_hash(payload: dict[str, Any]) -> str:
    """Public content hash helper for pending-artifact integrity checks."""
    return _content_hash(payload)


def render_course_blueprint_markdown(payload: dict[str, Any]) -> str:
    """Compact markdown preview of a full Course Blueprint (CourseBlueprintRecommendation)."""
    lines = [f"# {str(payload.get('title') or 'Course Plan')}", ""]
    if payload.get("summary"):
        lines += [str(payload["summary"]), ""]
    scope = str(payload.get("plan_scope") or "")
    horizon = payload.get("planning_horizon_weeks")
    meta = [f"**Scope:** {scope}" if scope else "", f"**Weeks:** {horizon}" if horizon else ""]
    meta = [m for m in meta if m]
    if meta:
        lines += [" · ".join(meta), ""]
    weekly = payload.get("weekly_plan")
    if isinstance(weekly, list) and weekly:
        lines += ["## Weekly Plan", ""]
        for w in weekly:
            if not isinstance(w, dict):
                continue
            lines.append(f"**Week {w.get('week')}: {str(w.get('theme') or '')}**")
            for label, key in (("Lesson", "lesson_goal"), ("Lab", "lab_goal"), ("Assessment", "assessment_idea")):
                if w.get(key):
                    lines.append(f"- {label}: {w[key]}")
            lines.append("")
    for label, key in (("Assessment Strategy", "assessment_strategy"), ("Lab Strategy", "lab_strategy")):
        if payload.get(key):
            lines += [f"## {label}", str(payload[key]), ""]
    prefs = payload.get("teaching_preferences")
    if isinstance(prefs, dict) and prefs:
        lines += ["## Teaching Preferences"] + [f"- **{k}:** {v}" for k, v in prefs.items()] + [""]
    return "\n".join(lines).strip()


def _render_preview_markdown(artifact_type: str, payload: dict[str, Any], fallback: str) -> tuple[str, str]:
    if artifact_type == "lesson_plan":
        return render_lesson_plan_markdown(payload), LESSON_PLAN_MARKDOWN_RENDERER_VERSION
    if artifact_type == "lab":
        return render_lab_markdown(payload), LAB_MARKDOWN_RENDERER_VERSION
    if artifact_type == "quiz":
        return render_quiz_markdown(payload), QUIZ_MARKDOWN_RENDERER_VERSION
    if artifact_type == "course_blueprint":
        return render_course_blueprint_markdown(payload), "course_blueprint_markdown.v1"
    if artifact_type == "game":
        return render_game_markdown(payload), GAME_MARKDOWN_RENDERER_VERSION
    return fallback, "agent_final_text.v1"


def render_preview_markdown(
    artifact_type: str,
    payload: dict[str, Any],
    fallback: str = "",
) -> tuple[str, str]:
    """Public preview renderer used by pending artifacts and saved drafts."""
    return _render_preview_markdown(artifact_type, payload, fallback)


def _export_idempotency_key(artifact_id: str, export_target: str, content_hash: str) -> str:
    return f"{artifact_id}:{export_target}:{content_hash}"


def _has_existing_export(artifact: dict[str, Any], content_hash: str, export_target: str) -> bool:
    return (
        artifact.get("export_status") == "exported"
        and str(artifact.get("content_hash") or "") == content_hash
        and str(artifact.get("export_idempotency_key") or "")
        == _export_idempotency_key(str(artifact.get("id") or ""), export_target, content_hash)
    )


def _mark_export_failed(ref: Any, original_status: str, original_is_current: bool, error: str, *, was_confirmed: bool) -> None:
    ref.update(
        {
            "status": original_status if was_confirmed else "failed_export",
            "export_status": "failed",
            "export_error": error[:1000],
            "is_current": original_is_current if was_confirmed else False,
            "updated_at": _now(),
        }
    )


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
        "export_status": "exported",
        "content_source": "agent_generated",
        "content_stale": False,
        "sync_error": "",
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
    return _save_generated_draft_from_session(
        batch_id=batch_id,
        lecturer_id=lecturer_id,
        chat_id=chat_id,
        run_id=run_id,
        artifact_type="lesson_plan",
        payload=lesson_plan_payload,
        rendered_markdown=rendered_markdown,
        lecturer_email=lecturer_email,
        default_title="Untitled Lesson Plan",
        missing_week_message="lesson_plan_full.week is required for draft artifact save",
    )


def save_lab_draft_from_session(
    batch_id: str,
    lecturer_id: str,
    chat_id: str,
    run_id: str,
    lab_payload: dict[str, Any],
    rendered_markdown: str = "",
    lecturer_email: str = "",
) -> dict[str, Any]:
    """Save or update a draft lab artifact produced by an Agent Engine run."""
    return _save_generated_draft_from_session(
        batch_id=batch_id,
        lecturer_id=lecturer_id,
        chat_id=chat_id,
        run_id=run_id,
        artifact_type="lab",
        payload=lab_payload,
        rendered_markdown=rendered_markdown,
        lecturer_email=lecturer_email,
        default_title="Untitled Lab",
        missing_week_message="lab_full.week is required for draft artifact save",
    )


def save_pending_artifact_as_draft(
    *,
    batch_id: str,
    lecturer_id: str,
    pending_artifact: dict[str, Any],
    lecturer_email: str = "",
) -> dict[str, Any]:
    """Create/update a real draft artifact from immutable pending-artifact JSON."""
    artifact_type = str(pending_artifact.get("artifact_type") or "").strip()
    payload = pending_artifact.get("content_json")
    if artifact_type not in {"lesson_plan", "lab", "quiz"}:
        raise RuntimeError("Pending artifact type is not exportable")
    if not isinstance(payload, dict) or not payload:
        raise RuntimeError("Pending artifact content is missing")

    expected_hash = str(pending_artifact.get("content_hash") or "")
    actual_hash = _content_hash(payload)
    if expected_hash and expected_hash != actual_hash:
        raise RuntimeError("Pending artifact content hash mismatch")

    common = {
        "batch_id": batch_id,
        "lecturer_id": lecturer_id,
        "chat_id": str(pending_artifact.get("source_chat_id") or ""),
        "run_id": str(pending_artifact.get("source_run_id") or ""),
        "rendered_markdown": str(pending_artifact.get("preview_markdown") or ""),
        "lecturer_email": lecturer_email,
    }
    if artifact_type == "lesson_plan":
        return save_lesson_plan_draft_from_session(
            lesson_plan_payload=payload,
            **common,
        )
    if artifact_type == "lab":
        return save_lab_draft_from_session(lab_payload=payload, **common)
    return save_quiz_draft_from_session(quiz_payload=payload, **common)


def save_quiz_draft_from_session(
    batch_id: str,
    lecturer_id: str,
    chat_id: str,
    run_id: str,
    quiz_payload: dict[str, Any],
    rendered_markdown: str = "",
    lecturer_email: str = "",
) -> dict[str, Any]:
    """Save or update a draft quiz artifact produced by an Agent Engine run."""
    return _save_generated_draft_from_session(
        batch_id=batch_id,
        lecturer_id=lecturer_id,
        chat_id=chat_id,
        run_id=run_id,
        artifact_type="quiz",
        payload=quiz_payload,
        rendered_markdown=rendered_markdown,
        lecturer_email=lecturer_email,
        default_title="Untitled Quiz",
        missing_week_message="quiz_full.week is required for draft artifact save",
    )


def _save_generated_draft_from_session(
    *,
    batch_id: str,
    lecturer_id: str,
    chat_id: str,
    run_id: str,
    artifact_type: str,
    payload: dict[str, Any],
    rendered_markdown: str = "",
    lecturer_email: str = "",
    default_title: str,
    missing_week_message: str,
) -> dict[str, Any]:
    """Save or update a draft artifact produced by an Agent Engine run."""
    if not _batch_owned_by(batch_id, lecturer_id):
        raise RuntimeError("Batch not found or access denied")

    title = str(payload.get("title") or default_title).strip()
    week = payload.get("week")
    try:
        week = int(week)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(missing_week_message) from exc

    col = _artifacts_col(batch_id)
    existing = [
        _doc_to_dict(doc)
        for doc in col.where("source_run_id", "==", run_id).stream()
        if (doc.to_dict() or {}).get("artifact_type") == artifact_type
    ]
    artifact_id = str(existing[0]["id"]) if existing else str(uuid.uuid4())
    now = _now()
    preview_markdown, preview_renderer_version = _render_preview_markdown(
        artifact_type,
        payload,
        rendered_markdown,
    )
    content_hash = _content_hash(payload)
    data = {
        "id": artifact_id,
        "type": artifact_type,
        "artifact_type": artifact_type,
        "status": "draft",
        "is_current": False,
        "version": None,
        "title": title,
        "batch_id": batch_id,
        "week": week,
        "content_json": payload,
        "content_schema_version": "v2",
        "content_hash": content_hash,
        "rendered_markdown": rendered_markdown,
        "preview_markdown": preview_markdown,
        "preview_renderer_version": preview_renderer_version,
        "export_status": "not_exported",
        "content_source": "agent_generated",
        "content_stale": False,
        "sync_error": "",
        "source_run_id": run_id,
        "source_chat_id": chat_id,
        "created_by": lecturer_id,
        "created_by_email": lecturer_email,
        "updated_at": now,
        "metadata": {
            "source": "agent_platform_session",
            "exportable": True,
            "content_hash": content_hash,
            "preview_renderer_version": preview_renderer_version,
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
    was_confirmed = artifact.get("status") == "confirmed"
    original_status = str(artifact.get("status") or "")
    original_is_current = bool(artifact.get("is_current", False))
    if artifact.get("status") not in {"draft", "failed_export", "confirmed"}:
        raise RuntimeError("Only draft or confirmed lesson plans can be exported")

    payload = artifact.get("content_json")
    if not isinstance(payload, dict) or not payload:
        raise RuntimeError("Draft lesson plan content is missing")
    content_hash = _content_hash(payload)
    if _has_existing_export(artifact, content_hash, "google_docs"):
        return {
            "artifact_id": artifact_id,
            "status": artifact.get("status"),
            "version": artifact.get("version"),
            "doc_url": artifact.get("doc_url", ""),
            "doc_id": artifact.get("doc_id", ""),
            "drive_file_name": artifact.get("drive_file_name", ""),
        }
    try:
        validate_export_coverage("lesson_plan", payload)
    except ArtifactExportCoverageError as exc:
        _mark_export_failed(
            ref,
            original_status,
            original_is_current,
            str(exc),
            was_confirmed=was_confirmed,
        )
        raise

    export_started = time.perf_counter()
    with log_span(logger, "export_oauth_check", kind="lesson_plan"):
        assert_google_oauth_valid(lecturer_id, ["documents", "drive.file"])

    week = int(payload.get("week") or artifact.get("week") or 0)
    title = str(payload.get("title") or artifact.get("title") or "Lesson Plan")
    with log_span(logger, "export_version_scan", kind="lesson_plan"):
        next_version = (
            int(artifact.get("version") or 0)
            if was_confirmed and artifact.get("version")
            else _next_confirmed_version(batch_id, "lesson_plan", week)
        )
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
        with log_span(logger, "export_doc_generation", kind="lesson_plan"):
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
                "status": original_status if was_confirmed else "failed_export",
                "export_status": "failed",
                "export_error": safe_error,
                "is_current": original_is_current if was_confirmed else False,
                "updated_at": _now(),
            }
        )
        raise RuntimeError(safe_error) from exc

    if not was_confirmed:
        _supersede_current_artifacts(batch_id, "lesson_plan", week, artifact_id)
    with log_span(logger, "export_drive_metadata", kind="lesson_plan"):
        export_metadata = _google_doc_export_metadata(
            uid=lecturer_id,
            doc_id=str(doc_result.get("doc_id") or ""),
        )
    updates = {
        "status": "confirmed",
        "is_current": original_is_current if was_confirmed else True,
        "version": next_version,
        "doc_url": doc_result.get("doc_url", ""),
        "doc_id": doc_result.get("doc_id", ""),
        "drive_file_name": doc_result.get("drive_file_name", drive_file_name),
        "drive_folder_id": doc_result.get("drive_folder_id", folder_id),
        "export_status": "exported",
        "content_hash": content_hash,
        "export_idempotency_key": _export_idempotency_key(artifact_id, "google_docs", content_hash),
        "content_source": "agent_generated",
        "content_stale": False,
        "sync_error": "",
        "exported_at": _now(),
        "updated_at": _now(),
        "export_error": "",
        **export_metadata,
    }
    with log_span(logger, "export_finalize", kind="lesson_plan"):
        ref.update(updates)
        _update_source_message_export_metadata(
            batch_id=batch_id,
            artifact=artifact,
            export_updates=updates,
        )
        saved = _doc_to_dict(ref.get())
    logger.info(
        "event=export_total kind=lesson_plan duration_ms=%d artifact_id=%s",
        int((time.perf_counter() - export_started) * 1000),
        artifact_id,
    )
    return {
        "artifact_id": artifact_id,
        "status": saved.get("status"),
        "version": saved.get("version"),
        "doc_url": saved.get("doc_url", ""),
        "doc_id": saved.get("doc_id", ""),
        "drive_file_name": saved.get("drive_file_name", ""),
    }


def export_lab_draft_to_google_docs(
    batch_id: str,
    artifact_id: str,
    lecturer_id: str,
) -> dict[str, Any]:
    """Export a draft lab artifact to lecturer/student Google Docs and confirm it."""
    batch, ref, artifact, payload = _load_exportable_draft(
        batch_id=batch_id,
        artifact_id=artifact_id,
        lecturer_id=lecturer_id,
        artifact_type="lab",
        label="lab",
    )

    week = int(payload.get("week") or artifact.get("week") or 0)
    title = str(payload.get("title") or artifact.get("title") or "Lab")
    was_confirmed = artifact.get("status") == "confirmed"
    original_status = str(artifact.get("status") or "")
    original_is_current = bool(artifact.get("is_current", False))
    content_hash = _content_hash(payload)
    if _has_existing_export(artifact, content_hash, "google_docs"):
        saved_metadata = artifact.get("metadata") or {}
        return {
            "artifact_id": artifact_id,
            "status": artifact.get("status"),
            "version": artifact.get("version"),
            "doc_url": artifact.get("doc_url", ""),
            "doc_id": artifact.get("doc_id", ""),
            "drive_file_name": artifact.get("drive_file_name", ""),
            "lecturer_doc_url": saved_metadata.get("lecturer_doc_url", ""),
            "lecturer_doc_id": saved_metadata.get("lecturer_doc_id", ""),
            "lecturer_drive_file_name": saved_metadata.get("lecturer_drive_file_name", ""),
            "lecturer_drive_folder_id": saved_metadata.get("lecturer_drive_folder_id")
            or artifact.get("drive_folder_id", ""),
            "lecturer_drive_folder_url": saved_metadata.get("lecturer_drive_folder_url")
            or artifact.get("drive_folder_url", ""),
            "student_doc_url": saved_metadata.get("student_doc_url", ""),
            "student_doc_id": saved_metadata.get("student_doc_id", ""),
            "student_drive_file_name": saved_metadata.get("student_drive_file_name", ""),
            "student_drive_folder_id": saved_metadata.get("student_drive_folder_id")
            or artifact.get("drive_folder_id", ""),
            "student_drive_folder_url": saved_metadata.get("student_drive_folder_url")
            or artifact.get("drive_folder_url", ""),
        }
    try:
        validate_export_coverage("lab", payload)
    except ArtifactExportCoverageError as exc:
        _mark_export_failed(
            ref,
            original_status,
            original_is_current,
            str(exc),
            was_confirmed=was_confirmed,
        )
        raise
    export_started = time.perf_counter()
    with log_span(logger, "export_oauth_check", kind="lab"):
        assert_google_oauth_valid(lecturer_id, ["documents", "drive.file"])
    with log_span(logger, "export_version_scan", kind="lab"):
        next_version = (
            int(artifact.get("version") or 0)
            if was_confirmed and artifact.get("version")
            else _next_confirmed_version(batch_id, "lab", week)
        )
    folders = ensure_batch_artifact_folders(
        uid=lecturer_id,
        batch_id=batch_id,
        batch_name=str(batch.get("batch_name") or artifact.get("batch_name") or ""),
        course_name=str(batch.get("course_name") or artifact.get("course_name") or ""),
    )
    drive_folders = folders.get("drive_folders") or {}
    lab_folder = drive_folders.get("lab") or {}
    folder_id = str(lab_folder.get("id") or "")
    folder_url = str(lab_folder.get("url") or "")
    lecturer_folder = drive_folders.get("lab_lecturer") or lab_folder
    student_folder = drive_folders.get("lab_student") or lab_folder
    lecturer_folder_id = str(lecturer_folder.get("id") or folder_id)
    lecturer_folder_url = str(lecturer_folder.get("url") or folder_url)
    student_folder_id = str(student_folder.get("id") or folder_id)
    student_folder_url = str(student_folder.get("url") or folder_url)

    # One folder per week per audience: the doc AND its materials land together,
    # so the chat card can link to the week's folder instead of individual docs
    # and sharing that folder shares the whole lab.
    week_label = f"Week {week:02d}"
    with log_span(logger, "export_week_folders", kind="lab"), ThreadPoolExecutor(
        max_workers=2
    ) as pool:
        lecturer_week_future = (
            pool.submit(get_or_create_folder, lecturer_id, week_label, lecturer_folder_id)
            if lecturer_folder_id
            else None
        )
        student_week_future = (
            pool.submit(get_or_create_folder, lecturer_id, week_label, student_folder_id)
            if student_folder_id
            else None
        )
        if lecturer_week_future is not None:
            lecturer_week = lecturer_week_future.result()
            lecturer_folder_id = lecturer_week["id"]
            lecturer_folder_url = lecturer_week["url"]
        if student_week_future is not None:
            student_week = student_week_future.result()
            student_folder_id = student_week["id"]
            student_folder_url = student_week["url"]

    lecturer_name = build_artifact_file_name(
        version=next_version,
        week=week,
        artifact_type="lab",
        title=title,
        suffix="Lecturer Guide",
    )
    student_name = build_artifact_file_name(
        version=next_version,
        week=week,
        artifact_type="lab",
        title=title,
        suffix="Student Instructions",
    )

    ref.update({"status": "exporting", "export_error": "", "updated_at": _now()})
    try:
        with log_span(logger, "export_doc_generation", kind="lab"):
            doc_result = create_lab_docs_for_user(
                uid=lecturer_id,
                lab_payload=payload,
                lecturer_email=str(batch.get("lecturer_email") or artifact.get("created_by_email") or ""),
                target_folder_id=folder_id,
                lecturer_target_folder_id=lecturer_folder_id,
                student_target_folder_id=student_folder_id,
                lecturer_drive_file_name=lecturer_name,
                student_drive_file_name=student_name,
            )
    except Exception as exc:
        safe_error = str(exc)[:1000]
        ref.update(
            {
                "status": original_status if was_confirmed else "failed_export",
                "export_status": "failed",
                "export_error": safe_error,
                "is_current": original_is_current if was_confirmed else False,
                "updated_at": _now(),
            }
        )
        raise RuntimeError(safe_error) from exc

    if not was_confirmed:
        _supersede_current_artifacts(batch_id, "lab", week, artifact_id)

    # Physical scaffold delivery: real Drive files next to the docs. Best-effort —
    # the files are also embedded in the docs' Lab Files section either way.
    # Runs concurrently with the (independent) Drive metadata read.
    starter_delivery: dict[str, str] = {}
    starter_files = payload.get("starter_files") or []
    with ThreadPoolExecutor(max_workers=2) as pool:
        metadata_future = pool.submit(
            _google_doc_export_metadata,
            uid=lecturer_id,
            doc_id=str(doc_result.get("lecturer_doc_id") or ""),
        )
        if isinstance(starter_files, list) and starter_files:
            from services.google_workspace.drive_folders import upload_lab_starter_files

            starter_delivery = upload_lab_starter_files(
                lecturer_id,
                starter_files=[f for f in starter_files if isinstance(f, dict)],
                student_parent_id=student_folder_id,
                lecturer_parent_id=lecturer_folder_id,
            )
        export_metadata = metadata_future.result()
    metadata = {
        **starter_delivery,
        "student_doc_url": doc_result.get("student_doc_url", ""),
        "student_doc_id": doc_result.get("student_doc_id", ""),
        "student_drive_file_name": doc_result.get("student_drive_file_name", student_name),
        "student_drive_folder_id": doc_result.get("student_drive_folder_id", student_folder_id),
        "student_drive_folder_url": student_folder_url,
        "lecturer_doc_url": doc_result.get("lecturer_doc_url", ""),
        "lecturer_doc_id": doc_result.get("lecturer_doc_id", ""),
        "lecturer_drive_file_name": doc_result.get("lecturer_drive_file_name", lecturer_name),
        "lecturer_drive_folder_id": doc_result.get("lecturer_drive_folder_id", lecturer_folder_id),
        "lecturer_drive_folder_url": lecturer_folder_url,
    }
    updates = {
        "status": "confirmed",
        "is_current": original_is_current if was_confirmed else True,
        "version": next_version,
        "doc_url": doc_result.get("lecturer_doc_url", ""),
        "doc_id": doc_result.get("lecturer_doc_id", ""),
        "drive_file_name": doc_result.get("lecturer_drive_file_name", lecturer_name),
        "drive_folder_id": metadata["lecturer_drive_folder_id"] or folder_id,
        "drive_folder_url": metadata["lecturer_drive_folder_url"] or folder_url,
        "metadata": metadata,
        "export_status": "exported",
        "content_hash": content_hash,
        "export_idempotency_key": _export_idempotency_key(artifact_id, "google_docs", content_hash),
        "content_source": "agent_generated",
        "content_stale": False,
        "sync_error": "",
        "exported_at": _now(),
        "updated_at": _now(),
        "export_error": "",
        **export_metadata,
    }
    with log_span(logger, "export_finalize", kind="lab"):
        ref.update(updates)
        _update_source_message_export_metadata(
            batch_id=batch_id,
            artifact=artifact,
            export_updates=updates,
        )
        saved = _doc_to_dict(ref.get())
    logger.info(
        "event=export_total kind=lab duration_ms=%d artifact_id=%s",
        int((time.perf_counter() - export_started) * 1000),
        artifact_id,
    )
    saved_metadata = saved.get("metadata") or {}
    return {
        "artifact_id": artifact_id,
        "status": saved.get("status"),
        "version": saved.get("version"),
        "doc_url": saved.get("doc_url", ""),
        "doc_id": saved.get("doc_id", ""),
        "drive_file_name": saved.get("drive_file_name", ""),
        "lecturer_doc_url": saved_metadata.get("lecturer_doc_url", ""),
        "lecturer_doc_id": saved_metadata.get("lecturer_doc_id", ""),
        "lecturer_drive_file_name": saved_metadata.get("lecturer_drive_file_name", ""),
        "lecturer_drive_folder_id": saved_metadata.get("lecturer_drive_folder_id")
        or saved.get("drive_folder_id", ""),
        "lecturer_drive_folder_url": saved_metadata.get("lecturer_drive_folder_url")
        or saved.get("drive_folder_url", ""),
        "student_doc_url": saved_metadata.get("student_doc_url", ""),
        "student_doc_id": saved_metadata.get("student_doc_id", ""),
        "student_drive_file_name": saved_metadata.get("student_drive_file_name", ""),
        "student_drive_folder_id": saved_metadata.get("student_drive_folder_id")
        or saved.get("drive_folder_id", ""),
        "student_drive_folder_url": saved_metadata.get("student_drive_folder_url")
        or saved.get("drive_folder_url", ""),
    }


def export_quiz_draft_to_google_forms(
    batch_id: str,
    artifact_id: str,
    lecturer_id: str,
) -> dict[str, Any]:
    """Export a draft quiz artifact to Google Forms and confirm it."""
    batch, ref, artifact, payload = _load_exportable_draft(
        batch_id=batch_id,
        artifact_id=artifact_id,
        lecturer_id=lecturer_id,
        artifact_type="quiz",
        label="quiz",
    )

    week = int(payload.get("week") or artifact.get("week") or 0)
    title = str(payload.get("title") or artifact.get("title") or "Quiz")
    was_confirmed = artifact.get("status") == "confirmed"
    original_status = str(artifact.get("status") or "")
    original_is_current = bool(artifact.get("is_current", False))
    content_hash = _content_hash(payload)
    if _has_existing_export(artifact, content_hash, "google_forms"):
        return {
            "artifact_id": artifact_id,
            "status": artifact.get("status"),
            "version": artifact.get("version"),
            "form_url": artifact.get("form_url", ""),
            "form_id": artifact.get("form_id", ""),
            "doc_url": artifact.get("doc_url", ""),
            "doc_id": artifact.get("doc_id", ""),
            "drive_file_name": artifact.get("drive_file_name", ""),
        }
    export_started = time.perf_counter()
    with log_span(logger, "export_oauth_check", kind="quiz"):
        assert_google_oauth_valid(lecturer_id, ["forms.body", "drive.file"])
    with log_span(logger, "export_version_scan", kind="quiz"):
        next_version = (
            int(artifact.get("version") or 0)
            if was_confirmed and artifact.get("version")
            else _next_confirmed_version(batch_id, "quiz", week)
        )
    folders = ensure_batch_artifact_folders(
        uid=lecturer_id,
        batch_id=batch_id,
        batch_name=str(batch.get("batch_name") or artifact.get("batch_name") or ""),
        course_name=str(batch.get("course_name") or artifact.get("course_name") or ""),
    )
    assessment_folder = (folders.get("drive_folders") or {}).get("assessment") or {}
    folder_id = str(assessment_folder.get("id") or "")
    folder_url = str(assessment_folder.get("url") or "")
    drive_file_name = build_artifact_file_name(
        version=next_version,
        week=week,
        artifact_type="quiz",
        title=title,
    )

    ref.update({"status": "exporting", "export_error": "", "updated_at": _now()})
    try:
        with log_span(logger, "export_doc_generation", kind="quiz"):
            form_result = create_quiz_form_for_user(
                uid=lecturer_id,
                quiz_payload=payload,
                lecturer_email=str(batch.get("lecturer_email") or artifact.get("created_by_email") or ""),
                target_folder_id=folder_id,
                drive_file_name=drive_file_name,
            )
    except Exception as exc:
        safe_error = str(exc)[:1000]
        ref.update(
            {
                "status": original_status if was_confirmed else "failed_export",
                "export_status": "failed",
                "export_error": safe_error,
                "is_current": original_is_current if was_confirmed else False,
                "updated_at": _now(),
            }
        )
        raise RuntimeError(safe_error) from exc

    if not was_confirmed:
        _supersede_current_artifacts(batch_id, "quiz", week, artifact_id)
    metadata = {
        "form_url": form_result.get("form_url", ""),
        "form_id": form_result.get("form_id", ""),
    }
    updates = {
        "status": "confirmed",
        "is_current": original_is_current if was_confirmed else True,
        "version": next_version,
        "doc_url": form_result.get("form_url", ""),
        "doc_id": form_result.get("form_id", ""),
        "form_url": form_result.get("form_url", ""),
        "form_id": form_result.get("form_id", ""),
        "drive_file_name": form_result.get("drive_file_name", drive_file_name),
        "drive_folder_id": form_result.get("drive_folder_id", folder_id),
        "drive_folder_url": folder_url,
        "metadata": metadata,
        "export_status": "exported",
        "content_hash": content_hash,
        "export_idempotency_key": _export_idempotency_key(artifact_id, "google_forms", content_hash),
        "content_source": "agent_generated",
        "content_stale": False,
        "sync_error": "",
        "exported_at": _now(),
        "updated_at": _now(),
        "export_error": "",
    }
    with log_span(logger, "export_finalize", kind="quiz"):
        ref.update(updates)
        _update_source_message_export_metadata(
            batch_id=batch_id,
            artifact=artifact,
            export_updates=updates,
        )
        saved = _doc_to_dict(ref.get())
    logger.info(
        "event=export_total kind=quiz duration_ms=%d artifact_id=%s",
        int((time.perf_counter() - export_started) * 1000),
        artifact_id,
    )
    return {
        "artifact_id": artifact_id,
        "status": saved.get("status"),
        "version": saved.get("version"),
        "form_url": saved.get("form_url", ""),
        "form_id": saved.get("form_id", ""),
        "doc_url": saved.get("doc_url", ""),
        "doc_id": saved.get("doc_id", ""),
        "drive_file_name": saved.get("drive_file_name", ""),
    }


def _load_exportable_draft(
    *,
    batch_id: str,
    artifact_id: str,
    lecturer_id: str,
    artifact_type: str,
    label: str,
) -> tuple[dict[str, Any], Any, dict[str, Any], dict[str, Any]]:
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
    actual_type = str(artifact.get("artifact_type") or artifact.get("type") or "")
    if actual_type != artifact_type:
        raise RuntimeError(f"Artifact is not a {label}")
    if artifact.get("status") not in {"draft", "failed_export", "confirmed"}:
        raise RuntimeError(f"Only draft or confirmed {label} artifacts can be exported")

    payload = artifact.get("content_json")
    if not isinstance(payload, dict) or not payload:
        raise RuntimeError(f"Draft {label} content is missing")
    return batch, ref, artifact, payload


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

    artifact_type = str(artifact.get("artifact_type") or artifact.get("type") or "")
    export_metadata = export_updates.get("metadata") or {}
    metadata = {
        "draft_artifact_id": str(artifact.get("id") or ""),
        "artifact_type": artifact_type,
        "week": artifact.get("week"),
        "exportable": False,
        "version": export_updates.get("version"),
        "drive_file_name": export_updates.get("drive_file_name", ""),
    }
    for key in (
        "doc_url",
        "doc_id",
        "form_url",
        "form_id",
        "lecturer_doc_url",
        "lecturer_doc_id",
        "lecturer_drive_file_name",
        "lecturer_drive_folder_url",
        "student_doc_url",
        "student_doc_id",
        "student_drive_file_name",
        "student_drive_folder_url",
    ):
        value = export_updates.get(key)
        if value:
            metadata[key] = value
        metadata_value = export_metadata.get(key)
        if metadata_value:
            metadata[key] = metadata_value
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


def _google_doc_export_metadata(uid: str, doc_id: str) -> dict[str, Any]:
    """Best-effort Drive metadata captured after Google Docs export."""
    if not doc_id:
        return {}
    try:
        metadata = get_drive_file_metadata(uid, doc_id)
    except Exception:
        logger.exception("Failed to read Drive metadata for exported doc_id=%s", doc_id)
        return {"last_synced_from_google_at": _now()}
    return {
        "google_modified_time": str(metadata.get("modifiedTime") or ""),
        "google_version": str(metadata.get("version") or ""),
        "last_synced_from_google_at": _now(),
    }


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
        "export_status": "exported",
        "content_source": "agent_generated",
        "content_stale": False,
        "sync_error": "",
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
        "export_status": "exported",
        "content_source": "agent_generated",
        "content_stale": False,
        "sync_error": "",
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


def confirm_artifact(
    batch_id: str,
    artifact_id: str,
    lecturer_id: str,
) -> dict[str, Any] | None:
    """Confirm a draft artifact without exporting or calling Google APIs."""
    if not _batch_owned_by(batch_id, lecturer_id):
        return None

    ref = _artifacts_col(batch_id).document(artifact_id)
    snap = ref.get()
    if not snap.exists:
        return None

    artifact = _doc_to_dict(snap)
    if artifact.get("status") not in {"draft", "failed_export"}:
        raise RuntimeError("Only draft artifacts can be confirmed")
    if not artifact.get("content_json") and not str(artifact.get("rendered_markdown") or "").strip():
        raise RuntimeError("Draft artifact has no saved content")

    artifact_type = str(artifact.get("artifact_type") or artifact.get("type") or "")
    week = artifact.get("week")
    next_version = _next_confirmed_version(batch_id, artifact_type, week)
    _supersede_current_artifacts(batch_id, artifact_type, week, artifact_id)
    ref.update(
        {
            "status": "confirmed",
            "is_current": True,
            "version": next_version,
            "export_status": artifact.get("export_status") or "not_exported",
            "content_source": artifact.get("content_source") or "agent_generated",
            "content_stale": bool(artifact.get("content_stale", False)),
            "sync_error": str(artifact.get("sync_error") or ""),
            "updated_at": _now(),
        }
    )
    return _doc_to_dict(ref.get())


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
