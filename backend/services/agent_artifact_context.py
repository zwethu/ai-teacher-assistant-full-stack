"""Lightweight artifact context for Agent Engine session state."""

from __future__ import annotations

import logging
from typing import Any

from services.artifact_service import artifact_summary, list_artifacts

logger = logging.getLogger(__name__)

ARTIFACT_TYPES = ("lesson_plan", "lab", "quiz")


def _empty_counts() -> dict[str, dict[str, int]]:
    return {artifact_type: {"current": 0, "total": 0} for artifact_type in ARTIFACT_TYPES}


def _empty_weeks() -> dict[str, list[int]]:
    return {artifact_type: [] for artifact_type in ARTIFACT_TYPES}


def _artifact_type(item: dict[str, Any]) -> str:
    return str(item.get("type") or item.get("artifact_type") or "other")


def _content_available(item: dict[str, Any]) -> bool:
    metadata = item.get("metadata") or {}
    return bool(
        item.get("content_json")
        or str(item.get("rendered_markdown") or "").strip()
        or str(item.get("doc_url") or "").strip()
        or str(item.get("form_url") or "").strip()
        or str(metadata.get("form_url") or "").strip()
        or str(metadata.get("student_doc_url") or "").strip()
    )


def _safe_item(item: dict[str, Any]) -> dict[str, Any]:
    metadata = item.get("metadata") or {}
    return {
        "artifact_id": str(item.get("id") or item.get("artifact_id") or ""),
        "type": _artifact_type(item),
        "artifact_type": _artifact_type(item),
        "week": item.get("week"),
        "title": str(item.get("title") or "Untitled"),
        "status": str(item.get("status") or ""),
        "is_current": bool(item.get("is_current", False)),
        "version": item.get("version"),
        "export_status": str(item.get("export_status") or ""),
        "content_available": _content_available(item),
        "content_source": str(item.get("content_source") or ""),
        "content_stale": bool(item.get("content_stale", False)),
        "doc_url": str(item.get("doc_url") or ""),
        "form_url": str(item.get("form_url") or metadata.get("form_url") or ""),
        "created_at": str(item.get("created_at") or ""),
        "updated_at": str(item.get("updated_at") or ""),
    }


def _summary_text(current_weeks: dict[str, list[int]]) -> str:
    parts: list[str] = []
    labels = {
        "lesson_plan": "lesson_plan",
        "lab": "lab",
        "quiz": "quiz",
    }
    for artifact_type in ARTIFACT_TYPES:
        weeks = current_weeks.get(artifact_type) or []
        value = ",".join(str(week) for week in weeks) if weeks else "none"
        parts.append(f"{labels[artifact_type]} weeks {value}")
    return f"Current artifacts: {'; '.join(parts)}."


def _failed_manifest() -> dict[str, Any]:
    return {
        "status": "failed",
        "summary_text": "Artifact manifest unavailable for this run.",
        "items": [],
        "counts": {},
        "current_weeks": {},
    }


def build_agent_artifact_manifest(batch_id: str, lecturer_id: str) -> dict[str, Any]:
    """Return lightweight batch artifact metadata for agent awareness.

    This manifest intentionally excludes full artifact bodies such as
    content_json and rendered_markdown. Agents must use read-only lookup tools
    when a teacher asks for artifact content.
    """
    try:
        summary = artifact_summary(batch_id, lecturer_id)
        if summary is None:
            return {
                "status": "empty",
                "counts": _empty_counts(),
                "current_weeks": _empty_weeks(),
                "items": [],
                "summary_text": "No artifact manifest is available for this batch.",
            }
        items = list_artifacts(batch_id, lecturer_id)
    except Exception:
        logger.exception("Failed to build artifact manifest batch_id=%s", batch_id)
        return _failed_manifest()

    counts = _empty_counts()
    for artifact_type, values in (summary.get("counts") or {}).items():
        if artifact_type in counts and isinstance(values, dict):
            counts[artifact_type] = {
                "current": int(values.get("current") or 0),
                "total": int(values.get("total") or 0),
            }

    current_weeks = _empty_weeks()
    safe_items: list[dict[str, Any]] = []
    for item in items:
        artifact_type = _artifact_type(item)
        status = str(item.get("status") or "")
        if status in {"deleted", "superseded"}:
            continue
        if artifact_type not in ARTIFACT_TYPES:
            continue
        safe = _safe_item(item)
        safe_items.append(safe)
        if safe["status"] == "confirmed" and safe["is_current"] and safe["week"] is not None:
            try:
                week = int(safe["week"])
            except (TypeError, ValueError):
                continue
            current_weeks[artifact_type].append(week)

    for artifact_type in current_weeks:
        current_weeks[artifact_type] = sorted(set(current_weeks[artifact_type]))

    return {
        "status": "available" if safe_items else "empty",
        "counts": counts,
        "current_weeks": current_weeks,
        "items": safe_items,
        "summary_text": _summary_text(current_weeks),
    }
