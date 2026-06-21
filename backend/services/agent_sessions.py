"""Agent session and durable run metadata helpers."""

from __future__ import annotations

import re
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP

from utils.firestore_client import get_firestore

BATCHES_COLLECTION = "batches"
CHATS_SUBCOLLECTION = "chats"
RUNS_SUBCOLLECTION = "runs"

_SAFE_SESSION_CHARS = re.compile(r"[^a-z0-9-]+")
_REPEATED_HYPHENS = re.compile(r"-+")


def make_agent_session_id(chat_id: str) -> str:
    """Return an Agent Platform-safe session id for a Firestore chat id."""
    normalized = _SAFE_SESSION_CHARS.sub("-", chat_id.lower())
    normalized = _REPEATED_HYPHENS.sub("-", normalized).strip("-")
    session_id = f"pnai-chat-{normalized}"[:63].rstrip("-")
    return session_id or "pnai-chat"


def ensure_chat_agent_session(
    *,
    batch_id: str,
    chat_id: str,
    lecturer_id: str,
) -> str:
    """Return the chat's Agent session id, lazily backfilling old chat docs."""
    chat_ref = _chat_ref(batch_id, chat_id)
    snap = chat_ref.get()
    data = snap.to_dict() or {}
    agent_session_id = str(data.get("agent_session_id") or "").strip()
    if agent_session_id:
        return agent_session_id

    agent_session_id = make_agent_session_id(chat_id)
    chat_ref.update(
        {
            "agent_session_id": agent_session_id,
            "agent_user_id": lecturer_id,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    return agent_session_id


def create_agent_run_record(
    *,
    run_id: str,
    batch_id: str,
    chat_id: str,
    lecturer_id: str,
    agent_session_id: str,
    rtdb_run_path: str,
    message_preview: str,
    agent_engine_resource_name: str,
    connectors: dict | None = None,
    google_oauth_status: str = "missing",
    workflow_type: str = "",
    week: int | None = None,
    save_draft: bool = False,
) -> None:
    connectors = {
        "web_search": bool((connectors or {}).get("web_search", True)),
        "google_workspace": bool((connectors or {}).get("google_workspace", False)),
    }
    run_ref = _run_ref(batch_id, chat_id, run_id)
    run_ref.set(
        {
            "run_id": run_id,
            "batch_id": batch_id,
            "chat_id": chat_id,
            "lecturer_id": lecturer_id,
            "agent_session_id": agent_session_id,
            "rtdb_run_path": rtdb_run_path,
            "status": "running",
            "message_preview": message_preview[:200],
            "agent_engine_resource_name": agent_engine_resource_name,
            "connectors": connectors,
            "google_workspace_enabled": connectors.get("google_workspace", False),
            "google_oauth_status": google_oauth_status,
            "workflow_type": workflow_type,
            "week": week,
            "save_draft": save_draft,
            "created_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    _chat_ref(batch_id, chat_id).update(
        {
            "active_run_id": run_id,
            "last_run_id": run_id,
            "last_run_status": "running",
            "agent_session_id": agent_session_id,
            "agent_user_id": lecturer_id,
            "agent_engine_resource_name": agent_engine_resource_name,
            "updated_at": SERVER_TIMESTAMP,
        }
    )


def mark_agent_run_done(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    final_message_id: str = "",
) -> None:
    updates: dict[str, Any] = {
        "status": "done",
        "completed_at": SERVER_TIMESTAMP,
        "updated_at": SERVER_TIMESTAMP,
    }
    if final_message_id:
        updates["final_message_id"] = final_message_id
    _run_ref(batch_id, chat_id, run_id).update(updates)
    _chat_ref(batch_id, chat_id).update(
        {
            "active_run_id": "",
            "last_run_id": run_id,
            "last_run_status": "done",
            "updated_at": SERVER_TIMESTAMP,
        }
    )


def mark_agent_run_failed(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    error: str,
) -> None:
    _run_ref(batch_id, chat_id, run_id).update(
        {
            "status": "failed",
            "error": error,
            "completed_at": SERVER_TIMESTAMP,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    _chat_ref(batch_id, chat_id).update(
        {
            "active_run_id": "",
            "last_run_id": run_id,
            "last_run_status": "failed",
            "updated_at": SERVER_TIMESTAMP,
        }
    )


def mark_agent_run_draft_saved(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    artifact_id: str,
    week: int | None,
) -> None:
    _run_ref(batch_id, chat_id, run_id).update(
        {
            "draft_artifact_id": artifact_id,
            "draft_status": "saved",
            "draft_error": "",
            "week": week,
            "updated_at": SERVER_TIMESTAMP,
        }
    )


def mark_agent_run_draft_failed(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    error: str,
) -> None:
    _run_ref(batch_id, chat_id, run_id).update(
        {
            "draft_status": "failed",
            "draft_error": str(error)[:1000],
            "updated_at": SERVER_TIMESTAMP,
        }
    )


def _chat_ref(batch_id: str, chat_id: str):
    return (
        get_firestore()
        .collection(BATCHES_COLLECTION)
        .document(batch_id)
        .collection(CHATS_SUBCOLLECTION)
        .document(chat_id)
    )


def _run_ref(batch_id: str, chat_id: str, run_id: str):
    return _chat_ref(batch_id, chat_id).collection(RUNS_SUBCOLLECTION).document(run_id)


def _run_to_dict(data: dict[str, Any]) -> dict[str, Any]:
    created = data.get("created_at")
    completed = data.get("completed_at")
    connectors = data.get("connectors") or {}
    return {
        "run_id": str(data.get("run_id") or ""),
        "status": str(data.get("status") or ""),
        "error": str(data.get("error") or ""),
        "final_message_id": str(data.get("final_message_id") or ""),
        "rtdb_run_path": str(data.get("rtdb_run_path") or ""),
        "workflow_type": str(data.get("workflow_type") or ""),
        "week": data.get("week"),
        "save_draft": bool(data.get("save_draft", False)),
        "draft_artifact_id": str(data.get("draft_artifact_id") or ""),
        "draft_status": str(data.get("draft_status") or ""),
        "draft_error": str(data.get("draft_error") or ""),
        "connectors": {
            "web_search": bool(connectors.get("web_search", True)),
            "google_workspace": bool(connectors.get("google_workspace", False)),
        },
        "created_at": (
            created.isoformat()
            if hasattr(created, "isoformat")
            else (str(created) if created else None)
        ),
        "completed_at": (
            completed.isoformat()
            if hasattr(completed, "isoformat")
            else (str(completed) if completed else None)
        ),
    }


def get_agent_run(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    lecturer_id: str,
) -> dict[str, Any] | None:
    """Return durable run metadata after ownership check."""
    chat_snap = _chat_ref(batch_id, chat_id).get()
    if not chat_snap.exists:
        return None
    chat_data = chat_snap.to_dict() or {}
    if chat_data.get("lecturer_id") != lecturer_id:
        return None
    run_snap = _run_ref(batch_id, chat_id, run_id).get()
    if not run_snap.exists:
        return None
    return _run_to_dict(run_snap.to_dict() or {})
