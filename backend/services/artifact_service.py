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

logger = logging.getLogger(__name__)

BATCHES_COLLECTION = "batches"
ARTIFACTS_SUBCOLLECTION = "artifacts"


def _batch_ref(batch_id: str):
    return get_firestore().collection(BATCHES_COLLECTION).document(batch_id)


def _doc_to_dict(snapshot) -> dict[str, Any]:
    data = snapshot.to_dict() or {}
    data["id"] = snapshot.id
    return data


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
