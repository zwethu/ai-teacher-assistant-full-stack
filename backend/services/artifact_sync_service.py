"""Backend-owned Google Doc freshness sync for generated artifacts.

The deployed agent only reads Firestore artifact fields. This service uses the
lecturer's OAuth credentials to check exported Google Docs and backfill
``rendered_markdown`` before an agent run needs artifact continuity.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from services.google_workspace.credentials import (
    GoogleOAuthInvalidError,
    GoogleOAuthRequiredError,
    assert_google_oauth_valid,
)
from services.google_workspace.docs_service import read_doc_structured_for_user
from services.google_workspace.drive_folders import get_drive_file_metadata
from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

BATCHES_COLLECTION = "batches"
ARTIFACTS_SUBCOLLECTION = "artifacts"
SUPPORTED_DOC_TYPES = {"lesson_plan", "lab"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _batch_ref(batch_id: str):
    return get_firestore().collection(BATCHES_COLLECTION).document(batch_id)


def _artifacts_col(batch_id: str):
    return _batch_ref(batch_id).collection(ARTIFACTS_SUBCOLLECTION)


def _doc_to_dict(snapshot) -> dict[str, Any]:
    data = snapshot.to_dict() or {}
    data["id"] = snapshot.id
    return data


def _safe_error(exc: Exception) -> str:
    return str(exc)[:1000]


def _artifact_type(artifact: dict[str, Any]) -> str:
    return str(artifact.get("artifact_type") or artifact.get("type") or "").strip()


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _verify_batch_owner(batch_id: str, lecturer_id: str) -> bool:
    snap = _batch_ref(batch_id).get()
    return snap.exists and (snap.to_dict() or {}).get("lecturer_id") == lecturer_id


def _confirmed_current_artifacts(batch_id: str, artifact_type: str) -> list[dict[str, Any]]:
    return [
        _doc_to_dict(doc)
        for doc in _artifacts_col(batch_id).stream()
        if _artifact_type(doc.to_dict() or {}) == artifact_type
        and (doc.to_dict() or {}).get("status") == "confirmed"
        and (doc.to_dict() or {}).get("is_current", True)
    ]


def _format_markdown_from_structured_doc(structured: dict[str, Any]) -> str:
    lines: list[str] = []
    title = str(structured.get("title") or "").strip()
    if title:
        lines.append(f"# {title}")

    paragraphs = [str(item).strip() for item in structured.get("paragraphs") or [] if str(item).strip()]
    if paragraphs:
        if lines:
            lines.append("")
        lines.extend(paragraphs)

    tables = structured.get("tables") or []
    for table_index, table in enumerate(tables, start=1):
        if lines:
            lines.append("")
        lines.append(f"Table {table_index}:")
        for row in table or []:
            cells = [str(cell or "").strip() for cell in row]
            lines.append(" | ".join(cells))

    links = [str(item).strip() for item in structured.get("links") or [] if str(item).strip()]
    if links:
        lines.append("")
        lines.append("Links:")
        lines.extend(f"- {link}" for link in links)

    return "\n".join(lines).strip()


def get_drive_file_freshness(uid: str, doc_id: str) -> dict[str, Any]:
    """Return Drive file freshness metadata for one Google Doc."""
    assert_google_oauth_valid(uid, ["documents", "drive.file"])
    metadata = get_drive_file_metadata(uid, doc_id)
    return {
        "id": str(metadata.get("id") or doc_id),
        "name": str(metadata.get("name") or ""),
        "mime_type": str(metadata.get("mimeType") or ""),
        "modified_time": str(metadata.get("modifiedTime") or ""),
        "version": str(metadata.get("version") or ""),
        "trashed": bool(metadata.get("trashed", False)),
    }


def sync_artifact_from_google_doc_if_stale(
    batch_id: str,
    artifact_id: str,
    lecturer_id: str,
) -> dict[str, Any]:
    """Sync one exported lesson/lab Google Doc into Firestore if Drive changed."""
    if not _verify_batch_owner(batch_id, lecturer_id):
        return {"status": "not_found", "artifact_id": artifact_id}

    ref = _artifacts_col(batch_id).document(artifact_id)
    snap = ref.get()
    if not snap.exists:
        return {"status": "missing", "artifact_id": artifact_id}

    artifact = _doc_to_dict(snap)
    artifact_type = _artifact_type(artifact)
    if artifact_type not in SUPPORTED_DOC_TYPES:
        return _item_result(artifact, "unsupported_type")
    if artifact.get("status") != "confirmed" or not artifact.get("is_current", True):
        return _item_result(artifact, "not_current")

    doc_id = str(artifact.get("doc_id") or "").strip()
    if not doc_id:
        return _item_result(artifact, "no_google_doc")

    try:
        freshness = get_drive_file_freshness(lecturer_id, doc_id)
    except GoogleOAuthRequiredError:
        return _item_result(artifact, "oauth_missing")
    except GoogleOAuthInvalidError:
        return _item_result(artifact, "oauth_invalid")
    except Exception as exc:
        logger.exception("Drive freshness check failed artifact=%s", artifact_id)
        safe = _safe_error(exc)
        ref.update({"content_stale": True, "sync_error": safe, "updated_at": _now()})
        return _item_result(artifact, "sync_failed", error=safe)

    if freshness.get("trashed"):
        ref.update({"content_stale": True, "sync_error": "Google Doc is trashed", "updated_at": _now()})
        return _item_result(artifact, "sync_failed", error="Google Doc is trashed")

    modified_time = str(freshness.get("modified_time") or "")
    version = str(freshness.get("version") or "")
    unchanged = (
        modified_time
        and version
        and str(artifact.get("google_modified_time") or "") == modified_time
        and str(artifact.get("google_version") or "") == version
        and bool(str(artifact.get("rendered_markdown") or "").strip())
    )
    if unchanged:
        return _item_result(artifact, "fresh", freshness=freshness)

    try:
        structured = read_doc_structured_for_user(lecturer_id, doc_id)
        rendered_markdown = _format_markdown_from_structured_doc(structured)
        if not rendered_markdown:
            raise RuntimeError("Google Doc did not contain readable text")
    except GoogleOAuthRequiredError:
        return _item_result(artifact, "oauth_missing")
    except GoogleOAuthInvalidError:
        return _item_result(artifact, "oauth_invalid")
    except Exception as exc:
        logger.exception("Google Doc sync failed artifact=%s", artifact_id)
        safe = _safe_error(exc)
        ref.update({"content_stale": True, "sync_error": safe, "updated_at": _now()})
        return _item_result(artifact, "sync_failed", freshness=freshness, error=safe)

    updates = {
        "rendered_markdown": rendered_markdown,
        "content_source": "google_doc_synced",
        "google_modified_time": modified_time,
        "google_version": version,
        "last_synced_from_google_at": _now(),
        "content_stale": False,
        "sync_error": "",
        "updated_at": _now(),
    }
    ref.update(updates)
    updated = _doc_to_dict(ref.get())
    return _item_result(updated, "synced", freshness=freshness)


def ensure_artifact_content_fresh(
    batch_id: str,
    lecturer_id: str,
    artifact_type: str,
    week: int,
) -> dict[str, Any]:
    """Sync the confirmed current artifact for one exact week if present."""
    if not _verify_batch_owner(batch_id, lecturer_id):
        return {"artifact_type": artifact_type, "week": week, "status": "batch_not_found"}
    artifact = next(
        (
            item
            for item in _confirmed_current_artifacts(batch_id, artifact_type)
            if _as_int(item.get("week")) == int(week)
        ),
        None,
    )
    if artifact is None:
        return {"artifact_type": artifact_type, "week": week, "status": "missing"}
    return sync_artifact_from_google_doc_if_stale(batch_id, str(artifact["id"]), lecturer_id)


def ensure_prior_artifact_content_fresh(
    batch_id: str,
    lecturer_id: str,
    artifact_type: str,
    before_week: int,
) -> dict[str, Any]:
    """Sync the latest confirmed current artifact before ``before_week`` if present."""
    if not _verify_batch_owner(batch_id, lecturer_id):
        return {"artifact_type": artifact_type, "before_week": before_week, "status": "batch_not_found"}
    prior = [
        item
        for item in _confirmed_current_artifacts(batch_id, artifact_type)
        if _as_int(item.get("week")) is not None and _as_int(item.get("week")) < before_week
    ]
    if not prior:
        return {"artifact_type": artifact_type, "before_week": before_week, "status": "missing"}
    artifact = max(prior, key=lambda item: _as_int(item.get("week")) or 0)
    return sync_artifact_from_google_doc_if_stale(batch_id, str(artifact["id"]), lecturer_id)


def preflight_sync_artifacts_for_agent_run(
    *,
    batch_id: str,
    lecturer_id: str,
    workflow_type: str,
    week: int | None,
    user_message: str,
) -> dict[str, Any]:
    """Conservatively sync only artifacts required by a structured agent workflow."""
    normalized = str(workflow_type or "").strip().lower()
    items: list[dict[str, Any]] = []

    def sync_exact(artifact_type: str) -> None:
        if week is None:
            items.append({"artifact_type": artifact_type, "status": "skipped", "reason": "week_unknown"})
            return
        items.append(ensure_artifact_content_fresh(batch_id, lecturer_id, artifact_type, int(week)))

    def sync_prior(artifact_type: str) -> None:
        if week is None:
            items.append({"artifact_type": artifact_type, "status": "skipped", "reason": "week_unknown"})
            return
        if int(week) <= 1:
            items.append({"artifact_type": artifact_type, "before_week": int(week), "status": "not_needed"})
            return
        items.append(ensure_prior_artifact_content_fresh(batch_id, lecturer_id, artifact_type, int(week)))

    if normalized in {"assessment", "quiz"}:
        sync_exact("lesson_plan")
    elif normalized == "lab":
        sync_exact("lesson_plan")
        sync_prior("lab")
    elif normalized == "lesson_plan":
        sync_prior("lesson_plan")
    elif normalized in {"course_consultant", "consultant"} and _consultant_needs_artifact_sync(user_message):
        if week is not None:
            sync_exact("lesson_plan")
        else:
            items.append({"artifact_type": "lesson_plan", "status": "skipped", "reason": "week_unknown"})
    else:
        return {"status": "skipped", "reason": "no_artifact_dependency", "items": []}

    return {
        "status": "completed",
        "items": items,
        "summary": _preflight_summary(items),
    }


def _consultant_needs_artifact_sync(message: str) -> bool:
    text = str(message or "").lower()
    artifact_terms = (
        "existing lesson plan",
        "exported doc",
        "google doc",
        "generated artifact",
        "saved lesson plan",
        "saved lab",
        "review the lesson plan",
        "review my lesson plan",
        "review the lab",
        "review my lab",
    )
    return any(term in text for term in artifact_terms)


def _preflight_summary(items: list[dict[str, Any]]) -> str:
    if not items:
        return "No artifact sync needed."
    counts: dict[str, int] = {}
    for item in items:
        status = str(item.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return ", ".join(f"{status}={count}" for status, count in sorted(counts.items()))


def _item_result(
    artifact: dict[str, Any],
    status: str,
    *,
    freshness: dict[str, Any] | None = None,
    error: str = "",
) -> dict[str, Any]:
    result = {
        "artifact_type": _artifact_type(artifact),
        "week": artifact.get("week"),
        "artifact_id": str(artifact.get("id") or ""),
        "status": status,
    }
    if freshness:
        result["google_modified_time"] = freshness.get("modified_time", "")
        result["google_version"] = freshness.get("version", "")
    if error:
        result["error"] = error
    return result
