"""Agent session and durable run metadata helpers."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore
from google.cloud.firestore import SERVER_TIMESTAMP

from utils.firestore_client import get_firestore

BATCHES_COLLECTION = "batches"
CHATS_SUBCOLLECTION = "chats"
RUNS_SUBCOLLECTION = "runs"
PENDING_EXPORT_LOCK_STALE_SECONDS = 10 * 60

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
    workflow_type: str = "",
    week: int | None = None,
    save_draft: bool = False,
    pending_artifact: bool = False,
    workflow_stage: str = "",
    approval_action: str = "",
    approved_outline_run_id: str = "",
    artifact_sync_preflight: dict[str, Any] | None = None,
) -> None:
    connectors = {
        "web_search": bool((connectors or {}).get("web_search", True)),
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
            "workflow_type": workflow_type,
            "week": week,
            "save_draft": save_draft,
            "pending_artifact": pending_artifact,
            "workflow_stage": workflow_stage,
            "approval_action": approval_action,
            "approved_outline_run_id": approved_outline_run_id,
            "artifact_sync_preflight": artifact_sync_preflight or {},
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


def mark_agent_run_awaiting_attachments(
    *, batch_id: str, chat_id: str, run_id: str, attachment_ids: list[str], deadline: Any
) -> None:
    """Hold a run until its attachments finish processing (deferred-run path)."""
    _run_ref(batch_id, chat_id, run_id).update(
        {
            "status": "awaiting_attachments",
            "awaiting_attachment_ids": list(attachment_ids),
            "awaiting_deadline": deadline,
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    _chat_ref(batch_id, chat_id).update(
        {"last_run_status": "awaiting_attachments", "updated_at": SERVER_TIMESTAMP}
    )


def stash_run_dispatch(
    *, batch_id: str, chat_id: str, run_id: str, session_state: dict[str, Any], user_message: str
) -> None:
    """Persist the inputs the agent-run task needs so it survives a restart."""
    _run_ref(batch_id, chat_id, run_id).update(
        {
            "dispatch_payload": {"session_state": session_state, "user_message": user_message},
            "updated_at": SERVER_TIMESTAMP,
        }
    )


def read_run_doc(*, batch_id: str, chat_id: str, run_id: str) -> dict[str, Any] | None:
    """Raw run doc (includes fields _run_to_dict does not project: dispatch_payload,
    awaiting_attachment_ids, awaiting_deadline)."""
    snap = _run_ref(batch_id, chat_id, run_id).get()
    return (snap.to_dict() or {}) if snap.exists else None


def claim_run_dispatch(*, batch_id: str, chat_id: str, run_id: str) -> bool:
    """Transactional once-only guard so a duplicate agent-run task can't double-invoke.
    Returns True for the single caller that should run; flips status to 'running'."""
    db = get_firestore()
    run_ref = _run_ref(batch_id, chat_id, run_id)
    transaction = db.transaction()

    @firestore.transactional
    def _commit(txn) -> bool:
        snap = run_ref.get(transaction=txn)
        data = snap.to_dict() or {}
        if not snap.exists or data.get("dispatched") or data.get("status") in {"done", "failed"}:
            return False
        txn.update(run_ref, {"dispatched": True, "status": "running", "updated_at": SERVER_TIMESTAMP})
        return True

    return _commit(transaction)


def refresh_run_attachment_context(
    *, batch_id: str, chat_id: str, run_id: str, attachment_context: dict[str, Any]
) -> None:
    """Merge refreshed attachment keys into the stashed session_state once files are ready."""
    run_ref = _run_ref(batch_id, chat_id, run_id)
    data = run_ref.get().to_dict() or {}
    payload = data.get("dispatch_payload") or {}
    session_state = payload.get("session_state") or {}
    session_state.update(attachment_context)
    payload["session_state"] = session_state
    run_ref.update({"dispatch_payload": payload, "updated_at": SERVER_TIMESTAMP})


def list_runs_awaiting_attachments(limit: int = 50) -> list[dict[str, Any]]:
    """Collection-group sweep for the watchdog. Requires a runs.status index."""
    docs = (
        get_firestore()
        .collection_group(RUNS_SUBCOLLECTION)
        .where("status", "==", "awaiting_attachments")
        .limit(limit)
        .stream()
    )
    return [doc.to_dict() or {} for doc in docs]


def persist_agent_run_timeline(
    *, batch_id: str, chat_id: str, run_id: str, timeline_snapshot: dict[str, Any]
) -> None:
    """Persist a bounded RTDB timeline for historical message rehydration."""
    if not timeline_snapshot:
        return
    _run_ref(batch_id, chat_id, run_id).update(
        {"timeline_snapshot": timeline_snapshot, "updated_at": SERVER_TIMESTAMP}
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


def mark_agent_run_pending_artifact(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    pending_artifact: dict[str, Any],
) -> None:
    _run_ref(batch_id, chat_id, run_id).update(
        {
            "pending_artifact": pending_artifact,
            "pending_artifact_id": str(pending_artifact.get("pending_artifact_id") or ""),
            "pending_artifact_status": str(pending_artifact.get("status") or ""),
            "updated_at": SERVER_TIMESTAMP,
        }
    )


def mark_agent_run_outline_ready(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    artifact_type: str,
    outline_payload: dict[str, Any],
    outline_context: dict[str, Any],
) -> None:
    """Persist an approvable outline snapshot and make it the chat's latest."""
    _run_ref(batch_id, chat_id, run_id).update(
        {
            "outline_status": "ready",
            "outline_artifact_type": artifact_type,
            "outline_payload": outline_payload,
            "outline_context": outline_context,
            "outline_content_hash": _content_hash(outline_payload),
            "updated_at": SERVER_TIMESTAMP,
        }
    )
    _chat_ref(batch_id, chat_id).update(
        {"latest_outline_run_id": run_id, "updated_at": SERVER_TIMESTAMP}
    )


def get_approvable_outline_run(
    *, batch_id: str, chat_id: str, run_id: str, lecturer_id: str
) -> dict[str, Any] | None:
    """Return an outline snapshot only when owned and still the latest revision."""
    chat_snap = _chat_ref(batch_id, chat_id).get()
    if not chat_snap.exists:
        return None
    chat = chat_snap.to_dict() or {}
    if chat.get("lecturer_id") != lecturer_id:
        return None
    run_snap = _run_ref(batch_id, chat_id, run_id).get()
    if not run_snap.exists:
        return None
    data = run_snap.to_dict() or {}
    data["is_latest_outline"] = str(chat.get("latest_outline_run_id") or "") == run_id
    return data


def invalidate_latest_outline_for_followup(
    *, batch_id: str, chat_id: str, lecturer_id: str
) -> str:
    """Mark the latest ready outline stale when the lecturer continues chatting."""
    db = get_firestore()
    chat_ref = _chat_ref(batch_id, chat_id)
    transaction = db.transaction()

    @firestore.transactional
    def _invalidate(txn):
        chat_snap = chat_ref.get(transaction=txn)
        if not chat_snap.exists:
            return ""
        chat = chat_snap.to_dict() or {}
        if chat.get("lecturer_id") != lecturer_id:
            return ""
        run_id = str(chat.get("latest_outline_run_id") or "")
        if not run_id:
            return ""
        run_ref = _run_ref(batch_id, chat_id, run_id)
        run_snap = run_ref.get(transaction=txn)
        if not run_snap.exists:
            txn.update(chat_ref, {"latest_outline_run_id": "", "updated_at": SERVER_TIMESTAMP})
            return ""
        run = run_snap.to_dict() or {}
        if run.get("outline_status") != "ready":
            return ""
        txn.update(
            run_ref,
            {"outline_status": "superseded", "updated_at": SERVER_TIMESTAMP},
        )
        txn.update(
            chat_ref,
            {"latest_outline_run_id": "", "updated_at": SERVER_TIMESTAMP},
        )
        return run_id

    return _invalidate(transaction)


def claim_approvable_outline_run(
    *, batch_id: str, chat_id: str, run_id: str, lecturer_id: str, artifact_type: str
) -> dict[str, Any]:
    """Atomically consume the latest outline so duplicate approvals cannot race."""
    db = get_firestore()
    chat_ref = _chat_ref(batch_id, chat_id)
    run_ref = _run_ref(batch_id, chat_id, run_id)
    transaction = db.transaction()

    @firestore.transactional
    def _claim(txn):
        chat_snap = chat_ref.get(transaction=txn)
        run_snap = run_ref.get(transaction=txn)
        if not chat_snap.exists or not run_snap.exists:
            raise LookupError("Approved outline run not found")
        chat = chat_snap.to_dict() or {}
        data = run_snap.to_dict() or {}
        if chat.get("lecturer_id") != lecturer_id:
            raise LookupError("Approved outline run not found")
        if str(chat.get("latest_outline_run_id") or "") != run_id:
            raise RuntimeError("A newer outline revision is available")
        if data.get("outline_status") != "ready":
            raise RuntimeError("Outline is not ready for approval")
        if data.get("outline_artifact_type") != artifact_type:
            raise RuntimeError("Outline artifact type does not match workflow")
        txn.update(run_ref, {"outline_status": "approved", "updated_at": SERVER_TIMESTAMP})
        txn.update(chat_ref, {"latest_outline_run_id": "", "updated_at": SERVER_TIMESTAMP})
        return data

    return _claim(transaction)


def _content_hash(payload: dict[str, Any]) -> str:
    import hashlib
    import json

    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def mark_agent_run_pending_artifact_exported(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    pending_artifact: dict[str, Any],
) -> None:
    updated = {
        **pending_artifact,
        "status": "exported",
        "export_lock_id": "",
        "export_error": "",
    }
    _run_ref(batch_id, chat_id, run_id).update(
        {
            "pending_artifact": updated,
            "pending_artifact_id": str(updated.get("pending_artifact_id") or ""),
            "pending_artifact_status": "exported",
            "draft_artifact_id": str(updated.get("artifact_id") or ""),
            "draft_status": "exported",
            "updated_at": SERVER_TIMESTAMP,
        }
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _lock_is_fresh(started_at: Any) -> bool:
    if not started_at:
        return False
    try:
        if isinstance(started_at, datetime):
            started = started_at
        else:
            started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return False
    return (datetime.now(timezone.utc) - started).total_seconds() < PENDING_EXPORT_LOCK_STALE_SECONDS


def claim_pending_artifact_export(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    lecturer_id: str,
) -> dict[str, Any]:
    """Transactionally claim a pending artifact export lock."""
    db = get_firestore()
    chat_ref = _chat_ref(batch_id, chat_id)
    run_ref = _run_ref(batch_id, chat_id, run_id)
    transaction = db.transaction()

    @firestore.transactional
    def _claim(txn):
        chat_snap = chat_ref.get(transaction=txn)
        if not chat_snap.exists or (chat_snap.to_dict() or {}).get("lecturer_id") != lecturer_id:
            raise PermissionError("Chat not found or access denied")

        run_snap = run_ref.get(transaction=txn)
        if not run_snap.exists:
            raise RuntimeError("Run not found")
        data = run_snap.to_dict() or {}
        pending = data.get("pending_artifact")
        if not isinstance(pending, dict):
            raise RuntimeError("Pending artifact not found")

        status_value = str(pending.get("status") or "")
        if status_value == "exported":
            return {
                "state": "already_exported",
                "pending_artifact": pending,
                "export_lock_id": str(pending.get("export_lock_id") or ""),
            }
        if status_value == "exporting" and _lock_is_fresh(pending.get("export_started_at")):
            return {
                "state": "in_progress",
                "pending_artifact": pending,
                "export_lock_id": str(pending.get("export_lock_id") or ""),
            }

        lock_id = uuid.uuid4().hex
        claimed = {
            **pending,
            "status": "exporting",
            "export_lock_id": lock_id,
            "export_started_at": _utc_now_iso(),
            "export_error": "",
        }
        txn.update(
            run_ref,
            {
                "pending_artifact": claimed,
                "pending_artifact_id": str(claimed.get("pending_artifact_id") or ""),
                "pending_artifact_status": "exporting",
                "updated_at": SERVER_TIMESTAMP,
            },
        )
        return {
            "state": "claimed",
            "pending_artifact": claimed,
            "export_lock_id": lock_id,
        }

    return _claim(transaction)


def mark_agent_run_pending_artifact_export_failed(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    error: str,
    export_lock_id: str,
) -> None:
    run_ref = _run_ref(batch_id, chat_id, run_id)
    snap = run_ref.get()
    if not snap.exists:
        return
    data = snap.to_dict() or {}
    pending = data.get("pending_artifact")
    if not isinstance(pending, dict):
        return
    if str(pending.get("export_lock_id") or "") != export_lock_id:
        return
    updated = {
        **pending,
        "status": "failed_export",
        "export_error": str(error)[:1000],
        "export_lock_id": "",
    }
    run_ref.update(
        {
            "pending_artifact": updated,
            "pending_artifact_status": "failed_export",
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
        "pending_artifact": bool(data.get("pending_artifact", False)),
        "workflow_stage": str(data.get("workflow_stage") or ""),
        "approval_action": str(data.get("approval_action") or ""),
        "approved_outline_run_id": str(data.get("approved_outline_run_id") or ""),
        "outline_status": str(data.get("outline_status") or ""),
        "outline_artifact_type": str(data.get("outline_artifact_type") or ""),
        "pending_artifact_id": str(data.get("pending_artifact_id") or ""),
        "pending_artifact_status": str(data.get("pending_artifact_status") or ""),
        "artifact_sync_preflight": data.get("artifact_sync_preflight") or {},
        "draft_artifact_id": str(data.get("draft_artifact_id") or ""),
        "draft_status": str(data.get("draft_status") or ""),
        "draft_error": str(data.get("draft_error") or ""),
        "connectors": {
            "web_search": bool(connectors.get("web_search", True)),
        },
        "timeline_snapshot": data.get("timeline_snapshot") or {},
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


def get_agent_run_with_pending_artifact(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    lecturer_id: str,
) -> dict[str, Any] | None:
    """Return durable run metadata including pending artifact after ownership check."""
    chat_snap = _chat_ref(batch_id, chat_id).get()
    if not chat_snap.exists:
        return None
    chat_data = chat_snap.to_dict() or {}
    if chat_data.get("lecturer_id") != lecturer_id:
        return None
    run_snap = _run_ref(batch_id, chat_id, run_id).get()
    if not run_snap.exists:
        return None
    data = run_snap.to_dict() or {}
    result = _run_to_dict(data)
    pending = data.get("pending_artifact")
    result["pending_artifact"] = pending if isinstance(pending, dict) else None
    return result
