"""Batch-level, lecturer-approved Course Blueprint persistence and context."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from google.cloud import firestore
from google.cloud.firestore import SERVER_TIMESTAMP

from entity.CourseBlueprint import CourseBlueprintContent, CourseBlueprintFromMessageRequest
from utils.firestore_client import get_firestore

BATCHES_COLLECTION = "batches"
BLUEPRINTS_SUBCOLLECTION = "course_blueprints"
CHATS_SUBCOLLECTION = "chats"
MESSAGES_SUBCOLLECTION = "messages"
GENERATION_WORKFLOW_FAMILIES = {"lesson_plan", "lab", "assessment", "quiz", "course_blueprint"}


class BlueprintNotFoundError(LookupError):
    pass


class BlueprintConflictError(RuntimeError):
    pass


class BlueprintEligibilityError(ValueError):
    pass


def _batch_ref(batch_id: str):
    return get_firestore().collection(BATCHES_COLLECTION).document(batch_id)


def _blueprints_col(batch_id: str):
    return _batch_ref(batch_id).collection(BLUEPRINTS_SUBCOLLECTION)


def _message_ref(batch_id: str, chat_id: str, message_id: str):
    return (
        _batch_ref(batch_id)
        .collection(CHATS_SUBCOLLECTION)
        .document(chat_id)
        .collection(MESSAGES_SUBCOLLECTION)
        .document(message_id)
    )


def _serialize(doc_id: str, data: dict[str, Any]) -> dict[str, Any]:
    result = {**data, "blueprint_id": str(data.get("blueprint_id") or doc_id)}
    for key in ("created_at", "updated_at"):
        value = result.get(key)
        if hasattr(value, "isoformat"):
            result[key] = value.isoformat()
    return result


def _owned_batch(batch_id: str, lecturer_id: str):
    ref = _batch_ref(batch_id)
    snap = ref.get()
    if not snap.exists or (snap.to_dict() or {}).get("lecturer_id") != lecturer_id:
        raise BlueprintNotFoundError("Batch not found or access denied")
    return ref, snap.to_dict() or {}


def get_current_blueprint(batch_id: str, lecturer_id: str) -> dict[str, Any] | None:
    _, batch = _owned_batch(batch_id, lecturer_id)
    blueprint_id = str(batch.get("current_course_blueprint_id") or "")
    if not blueprint_id:
        return None
    snap = _blueprints_col(batch_id).document(blueprint_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    if data.get("lecturer_id") != lecturer_id or not data.get("is_current"):
        return None
    return _serialize(snap.id, data)


def list_blueprint_history(batch_id: str, lecturer_id: str) -> list[dict[str, Any]]:
    _owned_batch(batch_id, lecturer_id)
    docs = _blueprints_col(batch_id).order_by("version", direction="DESCENDING").stream()
    return [
        _serialize(doc.id, doc.to_dict() or {})
        for doc in docs
        if (doc.to_dict() or {}).get("lecturer_id") == lecturer_id
    ]


def _is_ineligible_message(data: dict[str, Any]) -> str:
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    if data.get("role") != "assistant":
        return "Only assistant messages can be saved"
    if not str(data.get("content") or "").strip():
        return "Empty assistant messages cannot be saved"
    if data.get("status") in {"pending", "failed"} or data.get("pending") is True:
        return "Pending or failed messages cannot be saved"
    blocked = {
        "outline_approvable": metadata.get("outline_approvable") is True,
        "artifact_preview_card": metadata.get("artifact_preview_card") is True,
        "pending_exportable": metadata.get("pending_exportable") is True,
        "exportable": metadata.get("exportable") is True,
        "export_result": metadata.get("export_result") is True
        or bool(metadata.get("doc_url") or metadata.get("form_url")),
    }
    if any(blocked.values()):
        return "Artifact, outline, and export messages cannot be saved as a Course Blueprint"
    return ""


def _content_fields(content: CourseBlueprintContent) -> dict[str, Any]:
    return content.model_dump(mode="json")


def _hash_content(content: dict[str, Any]) -> str:
    import json
    return hashlib.sha256(
        json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def save_blueprint_from_message(
    batch_id: str,
    lecturer_id: str,
    payload: CourseBlueprintFromMessageRequest,
) -> dict[str, Any]:
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    message_ref = _message_ref(batch_id, payload.source_chat_id, payload.source_message_id)
    new_ref = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(f"blueprint_{uuid.uuid4().hex[:16]}")
    transaction = db.transaction()

    @firestore.transactional
    def _save(txn):
        batch_snap = batch_ref.get(transaction=txn)
        message_snap = message_ref.get(transaction=txn)
        batch = batch_snap.to_dict() or {}
        message = message_snap.to_dict() or {}
        if not batch_snap.exists or batch.get("lecturer_id") != lecturer_id:
            raise BlueprintNotFoundError("Batch not found or access denied")
        if not message_snap.exists or str(message.get("chat_id") or "") != payload.source_chat_id:
            raise BlueprintNotFoundError("Source assistant message not found")
        reason = _is_ineligible_message(message)
        if reason:
            raise BlueprintEligibilityError(reason)
        metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
        existing_id = str(metadata.get("course_blueprint_saved_id") or "")
        if existing_id:
            existing_snap = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(existing_id).get(transaction=txn)
            if existing_snap.exists:
                return existing_snap.id, existing_snap.to_dict() or {}, True

        current_id = str(batch.get("current_course_blueprint_id") or "")
        current_version = int(batch.get("current_course_blueprint_version") or 0)
        current_ref = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(current_id) if current_id else None
        current_snap = current_ref.get(transaction=txn) if current_ref else None
        content = _content_fields(payload)
        for key in ("source_chat_id", "source_message_id", "source_run_id"):
            content.pop(key, None)
        version = current_version + 1
        data = {
            **content,
            "blueprint_id": new_ref.id,
            "batch_id": batch_id,
            "lecturer_id": lecturer_id,
            "course_name": str(batch.get("course_name") or ""),
            "status": "active",
            "version": version,
            "is_current": True,
            "supersedes_blueprint_id": current_id,
            "superseded_by_blueprint_id": "",
            "source_proposal_id": "",
            "source_chat_id": payload.source_chat_id,
            "source_message_id": payload.source_message_id,
            "source_run_id": payload.source_run_id or str(message.get("run_id") or ""),
            "content_hash": _hash_content(content),
            "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
        if current_snap and current_snap.exists:
            txn.update(current_ref, {
                "status": "superseded", "is_current": False,
                "superseded_by_blueprint_id": new_ref.id, "updated_at": SERVER_TIMESTAMP,
            })
        txn.set(new_ref, data)
        txn.update(batch_ref, {
            "current_course_blueprint_id": new_ref.id,
            "current_course_blueprint_version": version,
            "updated_at": SERVER_TIMESTAMP,
        })
        txn.update(message_ref, {
            "metadata": {**metadata, "course_blueprint_saved_id": new_ref.id,
                         "course_blueprint_saved_version": version},
            "updated_at": SERVER_TIMESTAMP,
        })
        return new_ref.id, data, False

    blueprint_id, data, idempotent = _save(transaction)
    if idempotent:
        return {**_serialize(blueprint_id, data), "idempotent": True}
    saved = new_ref.get().to_dict() or data
    return {**_serialize(blueprint_id, saved), "idempotent": False}


def update_current_blueprint(
    batch_id: str, lecturer_id: str, content: CourseBlueprintContent
) -> dict[str, Any]:
    current = get_current_blueprint(batch_id, lecturer_id)
    if not current:
        raise BlueprintNotFoundError("No current Course Blueprint")
    # Reuse the source message transaction path only where a source exists is unsafe;
    # edits have no message. Use a dedicated pointer transaction.
    return _create_edited_version(batch_id, lecturer_id, content, current)


def _create_edited_version(batch_id: str, lecturer_id: str, content: CourseBlueprintContent,
                           expected: dict[str, Any]) -> dict[str, Any]:
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    new_ref = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(f"blueprint_{uuid.uuid4().hex[:16]}")
    transaction = db.transaction()

    @firestore.transactional
    def _save(txn):
        batch_snap = batch_ref.get(transaction=txn)
        batch = batch_snap.to_dict() or {}
        if not batch_snap.exists or batch.get("lecturer_id") != lecturer_id:
            raise BlueprintNotFoundError("Batch not found or access denied")
        current_id = str(batch.get("current_course_blueprint_id") or "")
        if not current_id or current_id != expected.get("blueprint_id"):
            raise BlueprintConflictError("The current Course Blueprint changed; refresh and try again")
        current_ref = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(current_id)
        current_snap = current_ref.get(transaction=txn)
        if not current_snap.exists:
            raise BlueprintNotFoundError("Current Course Blueprint not found")
        old = current_snap.to_dict() or {}
        version = int(batch.get("current_course_blueprint_version") or old.get("version") or 0) + 1
        fields = _content_fields(content)
        data = {
            **fields, "blueprint_id": new_ref.id, "batch_id": batch_id,
            "lecturer_id": lecturer_id, "course_name": str(batch.get("course_name") or ""),
            "status": "active", "version": version, "is_current": True,
            "supersedes_blueprint_id": current_id, "superseded_by_blueprint_id": "",
            "source_proposal_id": "", "source_chat_id": str(old.get("source_chat_id") or ""),
            "source_message_id": str(old.get("source_message_id") or ""),
            "source_run_id": str(old.get("source_run_id") or ""),
            "content_hash": _hash_content(fields), "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
        txn.update(current_ref, {"status": "superseded", "is_current": False,
                                 "superseded_by_blueprint_id": new_ref.id,
                                 "updated_at": SERVER_TIMESTAMP})
        txn.set(new_ref, data)
        txn.update(batch_ref, {"current_course_blueprint_id": new_ref.id,
                               "current_course_blueprint_version": version,
                               "updated_at": SERVER_TIMESTAMP})
        return data

    data = _save(transaction)
    saved = new_ref.get().to_dict() or data
    return _serialize(new_ref.id, saved)


def save_blueprint_from_content(
    batch_id: str,
    lecturer_id: str,
    content: CourseBlueprintContent,
    *,
    source_chat_id: str = "",
    source_run_id: str = "",
) -> dict[str, Any]:
    """Persist a new Course Blueprint version from run-generated content.

    Handles both create (no current -> v1) and supersede (current -> v+1). Used by the
    course-plan workflow's Confirm/Save terminal, where content comes from the run's
    validated pending artifact rather than an eligible chat message.
    """
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    new_ref = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(f"blueprint_{uuid.uuid4().hex[:16]}")
    transaction = db.transaction()

    @firestore.transactional
    def _save(txn):
        batch_snap = batch_ref.get(transaction=txn)
        batch = batch_snap.to_dict() or {}
        if not batch_snap.exists or batch.get("lecturer_id") != lecturer_id:
            raise BlueprintNotFoundError("Batch not found or access denied")
        current_id = str(batch.get("current_course_blueprint_id") or "")
        current_ref = _blueprints_col(batch_id).document(current_id) if current_id else None
        current_snap = current_ref.get(transaction=txn) if current_ref else None  # read before writes
        version = int(batch.get("current_course_blueprint_version") or 0) + 1
        fields = _content_fields(content)
        data = {
            **fields, "blueprint_id": new_ref.id, "batch_id": batch_id,
            "lecturer_id": lecturer_id, "course_name": str(batch.get("course_name") or ""),
            "status": "active", "version": version, "is_current": True,
            "supersedes_blueprint_id": current_id, "superseded_by_blueprint_id": "",
            "source_proposal_id": "", "source_chat_id": source_chat_id,
            "source_message_id": "", "source_run_id": source_run_id,
            "content_hash": _hash_content(fields), "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
        if current_snap is not None and current_snap.exists:
            txn.update(current_ref, {
                "status": "superseded", "is_current": False,
                "superseded_by_blueprint_id": new_ref.id, "updated_at": SERVER_TIMESTAMP,
            })
        txn.set(new_ref, data)
        txn.update(batch_ref, {
            "current_course_blueprint_id": new_ref.id,
            "current_course_blueprint_version": version,
            "updated_at": SERVER_TIMESTAMP,
        })
        return data

    data = _save(transaction)
    saved = new_ref.get().to_dict() or data
    return _serialize(new_ref.id, saved)


def archive_current_blueprint(batch_id: str, lecturer_id: str) -> dict[str, Any]:
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    transaction = db.transaction()

    @firestore.transactional
    def _archive(txn):
        batch_snap = batch_ref.get(transaction=txn)
        batch = batch_snap.to_dict() or {}
        if not batch_snap.exists or batch.get("lecturer_id") != lecturer_id:
            raise BlueprintNotFoundError("Batch not found or access denied")
        current_id = str(batch.get("current_course_blueprint_id") or "")
        if not current_id:
            raise BlueprintNotFoundError("No current Course Blueprint")
        current_ref = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(current_id)
        current_snap = current_ref.get(transaction=txn)
        if not current_snap.exists:
            raise BlueprintNotFoundError("Current Course Blueprint not found")
        txn.update(current_ref, {"status": "archived", "is_current": False,
                                 "updated_at": SERVER_TIMESTAMP})
        # Only the pointer is cleared. `current_course_blueprint_version` is a
        # high-water mark for numbering, not a pointer -- moving it backwards would
        # let the next save reuse a version number already present in history.
        txn.update(batch_ref, {"current_course_blueprint_id": "",
                               "updated_at": SERVER_TIMESTAMP})
        return current_id, current_snap.to_dict() or {}

    blueprint_id, data = _archive(transaction)
    return _serialize(blueprint_id, {**data, "status": "archived", "is_current": False})


def restore_archived_blueprint(batch_id: str, lecturer_id: str, blueprint_id: str) -> dict[str, Any]:
    """Undo an archive: make the archived version current again, in place.

    The exact inverse of `archive_current_blueprint`, and deliberately not a
    `revert_to_blueprint_version`. Archiving is a status change on one document, so
    undoing it has to be one too -- cloning the content into a new version leaves the
    lecturer holding a permanently archived twin of the plan they just brought back.
    Restricted to archived versions: reaching back into superseded history is what
    revert is for, and that path keeps the past immutable.
    """
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    target_ref = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(blueprint_id)
    transaction = db.transaction()

    @firestore.transactional
    def _restore(txn):
        batch_snap = batch_ref.get(transaction=txn)
        batch = batch_snap.to_dict() or {}
        if not batch_snap.exists or batch.get("lecturer_id") != lecturer_id:
            raise BlueprintNotFoundError("Batch not found or access denied")
        target_snap = target_ref.get(transaction=txn)
        if not target_snap.exists:
            raise BlueprintNotFoundError("Course Blueprint version not found")
        target = target_snap.to_dict() or {}
        if target.get("lecturer_id") != lecturer_id:
            raise BlueprintNotFoundError("Course Blueprint version not found")
        if target.get("status") != "archived":
            raise BlueprintEligibilityError("Only an archived Course Plan can be restored")
        current_id = str(batch.get("current_course_blueprint_id") or "")
        current_ref = (
            batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(current_id)
            if current_id and current_id != blueprint_id
            else None
        )
        current_snap = current_ref.get(transaction=txn) if current_ref else None  # read before writes
        version = int(target.get("version") or 0)
        if current_snap is not None and current_snap.exists:
            txn.update(current_ref, {
                "status": "superseded", "is_current": False,
                "superseded_by_blueprint_id": blueprint_id, "updated_at": SERVER_TIMESTAMP,
            })
        txn.update(target_ref, {
            "status": "active", "is_current": True,
            "superseded_by_blueprint_id": "", "updated_at": SERVER_TIMESTAMP,
        })
        txn.update(batch_ref, {
            "current_course_blueprint_id": blueprint_id,
            "current_course_blueprint_version": max(
                int(batch.get("current_course_blueprint_version") or 0), version
            ),
            "updated_at": SERVER_TIMESTAMP,
        })
        return {**target, "status": "active", "is_current": True,
                "superseded_by_blueprint_id": ""}

    data = _restore(transaction)
    return _serialize(blueprint_id, data)


def delete_blueprint_version(batch_id: str, lecturer_id: str, blueprint_id: str) -> dict[str, Any]:
    """Permanently delete a single Course Blueprint version. If it happens to be the
    current one, the batch's current pointer is cleared."""
    db = get_firestore()
    batch_ref = db.collection(BATCHES_COLLECTION).document(batch_id)
    bp_ref = batch_ref.collection(BLUEPRINTS_SUBCOLLECTION).document(blueprint_id)
    transaction = db.transaction()

    @firestore.transactional
    def _delete(txn):
        batch_snap = batch_ref.get(transaction=txn)
        batch = batch_snap.to_dict() or {}
        if not batch_snap.exists or batch.get("lecturer_id") != lecturer_id:
            raise BlueprintNotFoundError("Batch not found or access denied")
        bp_snap = bp_ref.get(transaction=txn)
        if not bp_snap.exists:
            raise BlueprintNotFoundError("Course Blueprint version not found")
        was_current = str(batch.get("current_course_blueprint_id") or "") == blueprint_id
        txn.delete(bp_ref)
        if was_current:
            # The version counter is left alone on purpose. Resetting it to 0 made the
            # next save start again at v1 -- colliding with the v1 still sitting in
            # history and giving the lecturer two rows both labelled "v1".
            txn.update(batch_ref, {
                "current_course_blueprint_id": "",
                "updated_at": SERVER_TIMESTAMP,
            })

    _delete(transaction)
    return {"blueprint_id": blueprint_id, "deleted": True}


def revert_to_blueprint_version(batch_id: str, lecturer_id: str, blueprint_id: str) -> dict[str, Any]:
    """Make a past version current again by saving its content as a new active
    version (history stays immutable — revert never rewrites the past)."""
    target_snap = _blueprints_col(batch_id).document(blueprint_id).get()
    if not target_snap.exists:
        raise BlueprintNotFoundError("Course Blueprint version not found")
    content = CourseBlueprintContent.model_validate(target_snap.to_dict() or {})
    return save_blueprint_from_content(batch_id, lecturer_id, content)


def build_blueprint_session_context(
    batch_id: str, lecturer_id: str, requested_week: int | None = None
) -> dict[str, Any]:
    empty = empty_blueprint_session_context()
    current = get_current_blueprint(batch_id, lecturer_id)
    if not current:
        return empty
    week_plan: dict[str, Any] = {}
    if requested_week is not None:
        week_plan = next(
            (item for item in current.get("weekly_plan", []) if item.get("week") == requested_week), {}
        )
    return {
        **empty,
        "active_course_blueprint_id": current["blueprint_id"],
        "active_course_blueprint_version": int(current.get("version") or 0),
        "course_blueprint_status": "active",
        "course_blueprint_summary": str(current.get("summary") or "")[:2000],
        "course_blueprint_week_plan": week_plan,
        "course_blueprint_assessment_strategy": str(current.get("assessment_strategy") or "")[:1200],
        "course_blueprint_lab_strategy": str(current.get("lab_strategy") or "")[:1200],
        "course_blueprint_teaching_preferences": dict(list((current.get("teaching_preferences") or {}).items())[:20]),
    }


def empty_blueprint_session_context() -> dict[str, Any]:
    return {
        "active_course_blueprint_id": "", "active_course_blueprint_version": 0,
        "course_blueprint_status": "none", "course_blueprint_summary": "",
        "course_blueprint_week_plan": {}, "course_blueprint_assessment_strategy": "",
        "course_blueprint_lab_strategy": "", "course_blueprint_teaching_preferences": {},
    }


def build_blueprint_status_context(
    batch_id: str, lecturer_id: str
) -> dict[str, Any]:
    """Return fresh minimal routing context for ordinary chat turns."""
    empty = empty_blueprint_session_context()
    current = get_current_blueprint(batch_id, lecturer_id)
    if not current:
        return empty
    return {
        **empty,
        "active_course_blueprint_id": current["blueprint_id"],
        "active_course_blueprint_version": int(current.get("version") or 0),
        "course_blueprint_status": "active",
        "course_blueprint_summary": str(current.get("summary") or "")[:1000],
    }


def is_generation_workflow(workflow_type: str) -> bool:
    family = workflow_type.strip().split(".")[0]
    return family in GENERATION_WORKFLOW_FAMILIES
