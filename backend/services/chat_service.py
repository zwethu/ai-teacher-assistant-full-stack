"""Chat persistence service — batches/{batch_id}/chats/{chat_id}/messages/{msg_id}."""

import logging
import uuid
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP
from google.cloud import firestore

from services.agent_sessions import make_agent_session_id
from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

BATCHES_COLLECTION = "batches"
CHATS_SUBCOLLECTION = "chats"
MESSAGES_SUBCOLLECTION = "messages"
RUNS_SUBCOLLECTION = "runs"
ATTACHMENTS_SUBCOLLECTION = "attachments"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _chats_col(batch_id: str):
    return (
        get_firestore()
        .collection(BATCHES_COLLECTION)
        .document(batch_id)
        .collection(CHATS_SUBCOLLECTION)
    )


def _messages_col(batch_id: str, chat_id: str):
    return _chats_col(batch_id).document(chat_id).collection(MESSAGES_SUBCOLLECTION)


def _runs_col(batch_id: str, chat_id: str):
    return _chats_col(batch_id).document(chat_id).collection(RUNS_SUBCOLLECTION)


def _chat_to_dict(doc_id: str, data: dict[str, Any]) -> dict[str, Any]:
    created = data.get("created_at")
    updated = data.get("updated_at")
    return {
        "chat_id": doc_id,
        "batch_id": str(data.get("batch_id") or ""),
        "lecturer_id": str(data.get("lecturer_id") or ""),
        "title": str(data.get("title") or "New Chat"),
        "agent_session_id": str(data.get("agent_session_id") or ""),
        "agent_user_id": str(data.get("agent_user_id") or ""),
        "active_run_id": str(data.get("active_run_id") or ""),
        "last_run_id": str(data.get("last_run_id") or ""),
        "last_run_status": str(data.get("last_run_status") or ""),
        "agent_engine_resource_name": str(data.get("agent_engine_resource_name") or ""),
        "type": str(data.get("type") or "chat"),
        "workflow_type": str(data.get("workflow_type") or ""),
        "week": data.get("week"),
        "hidden": bool(data.get("hidden", False)),
        "created_at": (created.isoformat() if hasattr(created, "isoformat") else (str(created) if created else None)),
        "updated_at": (updated.isoformat() if hasattr(updated, "isoformat") else (str(updated) if updated else None)),
    }


def _msg_to_dict(doc_id: str, data: dict[str, Any]) -> dict[str, Any]:
    created = data.get("created_at")
    return {
        "message_id": doc_id,
        "chat_id": str(data.get("chat_id") or ""),
        "role": str(data.get("role") or "user"),
        "content": str(data.get("content") or ""),
        "run_id": str(data.get("run_id") or ""),
        "metadata": data.get("metadata") or {},
        "attachments": data.get("attachments") or [],
        "created_at": (created.isoformat() if hasattr(created, "isoformat") else (str(created) if created else None)),
    }


# ---------------------------------------------------------------------------
# Chat CRUD
# ---------------------------------------------------------------------------

def create_chat(
    batch_id: str,
    lecturer_id: str,
    title: str = "New Chat",
    chat_type: str = "chat",
    workflow_type: str = "",
    week: int | None = None,
    hidden: bool = False,
) -> dict[str, Any]:
    col = _chats_col(batch_id)
    chat_id = str(uuid.uuid4())
    agent_session_id = make_agent_session_id(chat_id)
    doc = col.document(chat_id)
    doc.set(
        {
            "chat_id": chat_id,
            "batch_id": batch_id,
            "lecturer_id": lecturer_id,
            "agent_session_id": agent_session_id,
            "agent_user_id": lecturer_id,
            "active_run_id": "",
            "last_run_id": "",
            "last_run_status": "",
            "agent_engine_resource_name": "",
            "type": chat_type,
            "workflow_type": workflow_type,
            "week": week,
            "hidden": hidden,
            "title": title.strip() or "New Chat",
            "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    return {
        "chat_id": chat_id,
        "batch_id": batch_id,
        "lecturer_id": lecturer_id,
        "agent_session_id": agent_session_id,
        "agent_user_id": lecturer_id,
        "active_run_id": "",
        "last_run_id": "",
        "last_run_status": "",
        "agent_engine_resource_name": "",
        "type": chat_type,
        "workflow_type": workflow_type,
        "week": week,
        "hidden": hidden,
        "title": title,
    }


def list_chats(
    batch_id: str,
    lecturer_id: str,
    include_hidden: bool = False,
) -> list[dict[str, Any]]:
    """Return chats for a batch ordered newest first, filtered by lecturer_id."""
    col = _chats_col(batch_id)
    docs = col.where("lecturer_id", "==", lecturer_id).order_by("created_at", direction="DESCENDING").stream()
    chats = [_chat_to_dict(doc.id, doc.to_dict() or {}) for doc in docs]
    if not include_hidden:
        chats = [chat for chat in chats if not chat.get("hidden")]
    return chats


def get_chat(batch_id: str, chat_id: str, lecturer_id: str) -> dict[str, Any] | None:
    doc = _chats_col(batch_id).document(chat_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    if data.get("lecturer_id") != lecturer_id:
        return None
    return _chat_to_dict(doc.id, data)


def delete_chat(batch_id: str, chat_id: str, lecturer_id: str) -> bool:
    chat_ref = _chats_col(batch_id).document(chat_id)
    snap = chat_ref.get()
    data = snap.to_dict() or {}
    if not snap.exists or data.get("lecturer_id") != lecturer_id:
        return False
    if data.get("hidden"):
        return False
    from services.chat_attachment_service import delete_all_chat_attachments
    delete_all_chat_attachments(batch_id, chat_id)
    run_ids: list[str] = []
    for run in _runs_col(batch_id, chat_id).stream():
        run_ids.append(run.id)
        run.reference.delete()
    for msg in _messages_col(batch_id, chat_id).stream():
        msg.reference.delete()
    chat_ref.delete()
    try:
        from utils.rtdb_client import delete_chat_rtdb_state

        delete_chat_rtdb_state(chat_id, run_ids)
    except Exception as exc:
        logger.warning("RTDB cleanup skipped for chat %s: %s", chat_id, exc)
    return True


def delete_all_batch_chats(batch_id: str) -> None:
    """Delete all chats and their messages for a batch (used during batch deletion)."""
    col = _chats_col(batch_id)
    for chat_doc in col.stream():
        from services.chat_attachment_service import delete_all_chat_attachments
        delete_all_chat_attachments(batch_id, chat_doc.id)
        run_ids: list[str] = []
        for run in _runs_col(batch_id, chat_doc.id).stream():
            run_ids.append(run.id)
            run.reference.delete()
        for msg in _messages_col(batch_id, chat_doc.id).stream():
            msg.reference.delete()
        chat_doc.reference.delete()
        try:
            from utils.rtdb_client import delete_chat_rtdb_state

            delete_chat_rtdb_state(chat_doc.id, run_ids)
        except Exception as exc:
            logger.warning("RTDB cleanup skipped for chat %s: %s", chat_doc.id, exc)
    logger.info("Deleted all chats for batch %s", batch_id)


def get_or_create_workflow_chat(
    batch_id: str,
    lecturer_id: str,
    workflow_type: str,
    week: int | None,
    title: str,
) -> dict[str, Any]:
    """Return a hidden workflow chat for standalone page runs."""
    clean_workflow_type = str(workflow_type or "").strip()
    col = _chats_col(batch_id)
    docs = (
        col.where("lecturer_id", "==", lecturer_id)
        .where("type", "==", "workflow")
        .where("workflow_type", "==", clean_workflow_type)
        .where("week", "==", week)
        .limit(1)
        .stream()
    )
    for doc in docs:
        return _chat_to_dict(doc.id, doc.to_dict() or {})

    return create_chat(
        batch_id=batch_id,
        lecturer_id=lecturer_id,
        title=title,
        chat_type="workflow",
        workflow_type=clean_workflow_type,
        week=week,
        hidden=True,
    )


# ---------------------------------------------------------------------------
# Message CRUD
# ---------------------------------------------------------------------------

def add_message(
    batch_id: str,
    chat_id: str,
    role: str,
    content: str,
    lecturer_id: str,
    run_id: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist one message and bump chat updated_at."""
    msg_id = str(uuid.uuid4())
    doc: dict[str, Any] = {
        "message_id": msg_id,
        "chat_id": chat_id,
        "role": role,
        "content": content,
        "created_at": SERVER_TIMESTAMP,
    }
    if run_id:
        doc["run_id"] = run_id
    if metadata:
        doc["metadata"] = metadata
    col = _messages_col(batch_id, chat_id)
    col.document(msg_id).set(doc)
    _chats_col(batch_id).document(chat_id).update({"updated_at": SERVER_TIMESTAMP})
    result: dict[str, Any] = {"message_id": msg_id, "role": role, "content": content}
    if run_id:
        result["run_id"] = run_id
    if metadata:
        result["metadata"] = metadata
    return result


def _attachment_snapshot(data: dict[str, Any]) -> dict[str, Any]:
    """Stable message metadata; intentionally excludes extracted/vision text."""
    return {
        "attachment_id": str(data.get("attachment_id") or ""),
        "file_name": str(data.get("file_name") or ""),
        "file_title": str(data.get("file_title") or data.get("file_name") or ""),
        "content_type": str(data.get("content_type") or "application/octet-stream"),
        "size_bytes": int(data.get("size_bytes") or 0),
        "attachment_kind": str(data.get("attachment_kind") or "other"),
        "parse_status": str(data.get("parse_status") or "skipped"),
        "vision_status": str(data.get("vision_status") or "skipped"),
        "thumbnail_available": bool(data.get("thumbnail_gcs_path")),
        "promotion_allowed": False,
    }


def add_user_message_with_attachments(
    *, batch_id: str, chat_id: str, content: str, lecturer_id: str,
    run_id: str, attachment_ids: list[str] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Atomically persist a user message and claim its chat attachments."""
    from services.attachment_constants import (
        MAX_ATTACHMENTS_PER_MESSAGE, MAX_IMAGES_PER_MESSAGE,
        MAX_MESSAGE_ATTACHMENT_BYTES,
    )

    ids = list(dict.fromkeys(attachment_ids or []))
    if len(ids) != len(attachment_ids or []):
        raise ValueError("Duplicate attachment IDs are not allowed.")
    if len(ids) > MAX_ATTACHMENTS_PER_MESSAGE:
        raise ValueError(f"A message can include at most {MAX_ATTACHMENTS_PER_MESSAGE} attachments.")

    db = get_firestore()
    chat_ref = _chats_col(batch_id).document(chat_id)
    msg_id = str(uuid.uuid4())
    msg_ref = _messages_col(batch_id, chat_id).document(msg_id)
    refs = [chat_ref.collection(ATTACHMENTS_SUBCOLLECTION).document(item) for item in ids]
    transaction = db.transaction()

    @firestore.transactional
    def _commit(txn):
        chat_snap = chat_ref.get(transaction=txn)
        chat_data = chat_snap.to_dict() or {}
        if not chat_snap.exists or chat_data.get("lecturer_id") != lecturer_id:
            raise PermissionError("Chat not found or access denied")

        records: list[dict[str, Any]] = []
        for ref in refs:
            snap = ref.get(transaction=txn)
            data = snap.to_dict() or {}
            if not snap.exists:
                raise ValueError("Attachment not found.")
            if (
                data.get("lecturer_id") != lecturer_id
                or data.get("batch_id") != batch_id
                or data.get("chat_id") != chat_id
                or data.get("scope") != "chat"
            ):
                raise PermissionError("Attachment not found or access denied")
            if data.get("message_id"):
                raise ValueError("An attachment has already been sent.")
            records.append(data)

        if sum(1 for item in records if item.get("attachment_kind") == "image") > MAX_IMAGES_PER_MESSAGE:
            raise ValueError(f"A message can include at most {MAX_IMAGES_PER_MESSAGE} images.")
        if sum(int(item.get("size_bytes") or 0) for item in records) > MAX_MESSAGE_ATTACHMENT_BYTES:
            raise ValueError("Attachments exceed the 30 MB per-message limit.")

        snapshots = [_attachment_snapshot(item) for item in records]
        doc = {
            "message_id": msg_id, "chat_id": chat_id, "role": "user", "content": content,
            "run_id": run_id, "attachments": snapshots, "created_at": SERVER_TIMESTAMP,
        }
        txn.set(msg_ref, doc)
        for ref in refs:
            from services.attachment_constants import get_chat_attachment_retention_days
            from datetime import datetime, timedelta, timezone
            txn.update(ref, {"message_id": msg_id, "expires_at": datetime.now(timezone.utc) + timedelta(days=get_chat_attachment_retention_days()), "updated_at": SERVER_TIMESTAMP})
        txn.update(chat_ref, {"updated_at": SERVER_TIMESTAMP})
        return snapshots, records

    snapshots, records = _commit(transaction)
    from services.attachment_constants import get_chat_attachment_retention_days
    from services.chat_file_rag_service import update_attachment_chunks_expiry
    from datetime import datetime, timedelta, timezone
    chunk_expiry = datetime.now(timezone.utc) + timedelta(days=get_chat_attachment_retention_days())
    for attachment_id in ids:
        try:
            update_attachment_chunks_expiry(batch_id, chat_id, attachment_id, chunk_expiry, msg_id)
        except Exception:
            logger.exception("Failed to propagate attachment chunk association attachment_id=%s", attachment_id)
    return {
        "message_id": msg_id, "chat_id": chat_id, "role": "user", "content": content,
        "run_id": run_id, "attachments": snapshots,
    }, records


def update_assistant_message_metadata_for_run(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    metadata: dict[str, Any],
) -> None:
    """Merge metadata into assistant messages for a run."""
    for msg in (
        _messages_col(batch_id, chat_id)
        .where("run_id", "==", run_id)
        .where("role", "==", "assistant")
        .stream()
    ):
        existing = (msg.to_dict() or {}).get("metadata") or {}
        if not isinstance(existing, dict):
            existing = {}
        msg.reference.update(
            {
                "metadata": {**existing, **metadata},
                "updated_at": SERVER_TIMESTAMP,
            }
        )


def list_messages(batch_id: str, chat_id: str, lecturer_id: str) -> list[dict[str, Any]]:
    """Return messages for a chat oldest-first, after ownership check."""
    chat = get_chat(batch_id, chat_id, lecturer_id)
    if chat is None:
        return []
    col = _messages_col(batch_id, chat_id)
    return [
        _msg_to_dict(doc.id, doc.to_dict() or {})
        for doc in col.order_by("created_at").stream()
    ]


def update_chat_title(batch_id: str, chat_id: str, lecturer_id: str, title: str) -> bool:
    chat_ref = _chats_col(batch_id).document(chat_id)
    snap = chat_ref.get()
    if not snap.exists or (snap.to_dict() or {}).get("lecturer_id") != lecturer_id:
        return False
    chat_ref.update({"title": title.strip() or "New Chat", "updated_at": SERVER_TIMESTAMP})
    return True
