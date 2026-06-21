"""Chat persistence service — batches/{batch_id}/chats/{chat_id}/messages/{msg_id}."""

import logging
import uuid
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP

from services.agent_sessions import make_agent_session_id
from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

BATCHES_COLLECTION = "batches"
CHATS_SUBCOLLECTION = "chats"
MESSAGES_SUBCOLLECTION = "messages"


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
    if not snap.exists or (snap.to_dict() or {}).get("lecturer_id") != lecturer_id:
        return False
    for msg in _messages_col(batch_id, chat_id).stream():
        msg.reference.delete()
    chat_ref.delete()
    return True


def delete_all_batch_chats(batch_id: str) -> None:
    """Delete all chats and their messages for a batch (used during batch deletion)."""
    col = _chats_col(batch_id)
    for chat_doc in col.stream():
        for msg in _messages_col(batch_id, chat_doc.id).stream():
            msg.reference.delete()
        chat_doc.reference.delete()
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
