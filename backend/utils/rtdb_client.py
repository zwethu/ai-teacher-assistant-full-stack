"""Firebase Realtime Database client for the full-stack backend.

Owns the run lifecycle (meta, status, activeRunId) so the frontend can listen
to agentRuns/{run_id} for live process/tool event streams emitted by the agent.

The agent writes nested events directly to the same paths.  Backend is the
authoritative owner of: meta, status (running → done/failed), activeRunId.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any

logger = logging.getLogger(__name__)

_initialized: bool = False
_rtdb_available: bool = False
_rtdb_app: Any = None
_init_failures: int = 0
_MAX_INIT_FAILURES: int = 3


def _ensure_init() -> bool:
    global _initialized, _rtdb_available, _rtdb_app, _init_failures

    if _initialized:
        return _rtdb_available

    rtdb_url = os.getenv("FIREBASE_RTDB_URL", "")
    if not rtdb_url:
        logger.warning(
            "FIREBASE_RTDB_URL not set — run lifecycle events will be skipped"
        )
        _initialized = True
        return False

    try:
        import firebase_admin
        from firebase_admin import credentials

        app_name = "pnai-backend-rtdb"
        try:
            _rtdb_app = firebase_admin.get_app(app_name)
        except ValueError:
            sa_path = os.getenv("FIREBASE_SERVICE_ACCOUNT", "serviceAccountKey.json")
            if os.path.isfile(sa_path):
                cred = credentials.Certificate(sa_path)
            else:
                cred = credentials.ApplicationDefault()
            _rtdb_app = firebase_admin.initialize_app(
                cred,
                {"databaseURL": rtdb_url},
                name=app_name,
            )
            logger.info("RTDB backend app initialized → %s", rtdb_url)

        _initialized = True
        _rtdb_available = True
        _init_failures = 0
        return True

    except Exception as exc:
        _init_failures += 1
        if _init_failures >= _MAX_INIT_FAILURES:
            _initialized = True
            logger.error("RTDB backend init permanently disabled after %d failures: %s", _init_failures, exc)
        else:
            logger.warning("RTDB backend init failed (%d/%d): %s", _init_failures, _MAX_INIT_FAILURES, exc)
        _rtdb_available = False
        return False


def _ref(path: str) -> Any:
    from firebase_admin import db as rtdb_module
    return rtdb_module.reference(path, app=_rtdb_app)


# ---------------------------------------------------------------------------
# Run lifecycle
# ---------------------------------------------------------------------------

def create_run_meta(
    run_id: str,
    chat_id: str,
    batch_id: str,
    lecturer_id: str,
    message_preview: str = "",
    artifact_sync_preflight: dict | None = None,
) -> None:
    """Write initial run metadata and set status=running."""
    if not _ensure_init():
        return
    try:
        now = int(time.time())
        run_path = f"agentRuns/{run_id}"
        meta = {
            "run_id": run_id,
            "rtdb_run_path": run_path,
            "chat_id": chat_id,
            "batch_id": batch_id,
            "lecturer_id": lecturer_id,
            "message_preview": message_preview[:200],
            "created_at": now,
        }
        if artifact_sync_preflight:
            meta["artifact_sync_preflight"] = artifact_sync_preflight
        _ref(f"{run_path}/meta").set(meta)
        _ref(f"{run_path}/status").set("running")
        _ref(f"chats/{chat_id}/activeRunId").set(run_id)
        logger.debug("RTDB: created run meta run_id=%s", run_id)
    except Exception as exc:
        logger.warning("RTDB create_run_meta failed run_id=%s: %s", run_id, exc)


def set_run_status(run_id: str, status: str) -> None:
    """Update agentRuns/{run_id}/status ('running' | 'done' | 'failed')."""
    if not _ensure_init():
        return
    try:
        _ref(f"agentRuns/{run_id}/status").set(status)
        logger.debug("RTDB: run_id=%s status=%s", run_id, status)
    except Exception as exc:
        logger.warning("RTDB set_run_status failed run_id=%s: %s", run_id, exc)


def finalize_open_run_steps(run_id: str, run_status: str) -> None:
    """Close stale started/running step projections when a run becomes terminal.

    Agent-side progress telemetry is best effort, and some older helpers emit a
    start record without a matching terminal record. The backend owns the run
    lifecycle, so its terminal status is the authoritative fallback for those
    open projections.
    """
    if run_status not in {"done", "failed"} or not _ensure_init():
        return
    try:
        steps_ref = _ref(f"agentRuns/{run_id}/steps")
        steps = steps_ref.get() or {}
        if not isinstance(steps, dict):
            return

        terminal_status = "done" if run_status == "done" else "failed"
        now = int(time.time())
        updates: dict[str, Any] = {}
        for step_id, step in steps.items():
            if not isinstance(step, dict):
                continue
            status = str(step.get("status") or "").lower()
            if status in {"started", "running", "pending", ""}:
                updates[f"{step_id}/status"] = terminal_status
                updates[f"{step_id}/updated_at"] = now

        if updates:
            steps_ref.update(updates)
            logger.info(
                "RTDB finalized open run steps run_id=%s run_status=%s count=%d",
                run_id,
                run_status,
                len(updates) // 2,
            )
    except Exception as exc:
        logger.warning(
            "RTDB finalize_open_run_steps failed run_id=%s status=%s: %s",
            run_id,
            run_status,
            exc,
        )


def read_run_timeline_snapshot(run_id: str) -> dict[str, Any]:
    """Read a bounded events/steps snapshot for durable Firestore rehydration."""
    if not _ensure_init():
        return {}
    try:
        raw = _ref(f"agentRuns/{run_id}").get() or {}
        if not isinstance(raw, dict):
            return {}
        events_raw = raw.get("events") if isinstance(raw.get("events"), dict) else {}
        steps_raw = raw.get("steps") if isinstance(raw.get("steps"), dict) else {}

        def bounded(value: Any, depth: int = 0) -> Any:
            if depth >= 4:
                return str(value)[:500]
            if isinstance(value, str):
                return value[:2000]
            if isinstance(value, (bool, int, float)) or value is None:
                return value
            if isinstance(value, list):
                return [bounded(item, depth + 1) for item in value[:50]]
            if isinstance(value, dict):
                return {
                    str(key)[:200]: bounded(item, depth + 1)
                    for key, item in list(value.items())[:50]
                }
            return str(value)[:500]

        event_items = []
        for event_id, value in events_raw.items():
            if not isinstance(value, dict):
                continue
            event_items.append({**bounded(value), "event_id": str(event_id)})
        event_items.sort(key=lambda item: int(item.get("created_at") or 0))
        event_items = event_items[-200:]

        step_items: dict[str, Any] = {}
        ordered_steps = sorted(
            steps_raw.items(),
            key=lambda pair: int((pair[1] or {}).get("updated_at") or 0)
            if isinstance(pair[1], dict) else 0,
        )[-100:]
        for step_id, value in ordered_steps:
            if isinstance(value, dict):
                step_items[str(step_id)] = {**bounded(value), "step_id": str(step_id)}

        return {
            "events": event_items,
            "steps": step_items,
            "status": str(raw.get("status") or ""),
            "captured_at": int(time.time()),
        }
    except Exception as exc:
        logger.warning("RTDB timeline snapshot failed run_id=%s: %s", run_id, exc)
        return {}


def write_final_message(
    run_id: str,
    content: str,
    role: str = "assistant",
    metadata: dict | None = None,
    message_id: str | None = None,
) -> None:
    """Push the final assistant message into agentRuns/{run_id}/messages.

    `message_id` MUST be the Firestore message id. The client reads this node and
    keeps the id it finds, then uses it to delete (retry) or export that message —
    so a locally minted id here produces a message the API cannot address, and
    those calls 404. The fallback exists only for callers with nothing persisted.
    """
    if not _ensure_init():
        return
    try:
        msg_id = message_id or uuid.uuid4().hex[:16]
        message = {
            "message_id": msg_id,
            "role": role,
            "content": content,
            "created_at": int(time.time()),
        }
        if metadata:
            message["metadata"] = metadata
        _ref(f"agentRuns/{run_id}/messages/{msg_id}").set(message)
    except Exception as exc:
        logger.warning("RTDB write_final_message failed run_id=%s: %s", run_id, exc)


def write_stream_delta(
    run_id: str,
    index: int,
    delta: str,
    *,
    source: str | None = None,
    mode: str | None = None,
    upstream_event_kind: str | None = None,
) -> None:
    """Write one assistant text stream chunk to RTDB."""
    if not delta:
        return
    if not _ensure_init():
        return
    try:
        key = str(index)
        payload: dict[str, Any] = {
            "index": index,
            "delta": delta,
            "created_at": int(time.time()),
        }
        if source:
            payload["source"] = source
        if mode:
            payload["mode"] = mode
        if upstream_event_kind:
            payload["upstream_event_kind"] = upstream_event_kind
        _ref(f"agentRuns/{run_id}/stream_deltas/{key}").set(payload)
    except Exception as exc:
        logger.warning("RTDB write_stream_delta failed run_id=%s index=%s: %s", run_id, index, exc)


def write_run_event(
    run_id: str,
    *,
    event_type: str,
    kind: str = "process",
    status: str = "done",
    title: str = "",
    phase: str = "",
    summary: str = "",
    detail: dict[str, Any] | None = None,
    session_id: str = "",
    batch_id: str = "",
    chat_id: str = "",
    parent_id: str = "",
) -> str:
    """Append one backend-owned event using the shared run-event schema."""
    event_id = uuid.uuid4().hex[:16]
    if not _ensure_init():
        return event_id
    event = {
        "schema_version": "pnai.run_event.v1",
        "source": "backend",
        "event_type": event_type,
        "event_id": event_id,
        "run_id": run_id,
        "session_id": session_id,
        "batch_id": batch_id,
        "chat_id": chat_id,
        "kind": kind,
        "phase": phase,
        "parent_id": parent_id,
        "agent": "",
        "title": title or event_type,
        "status": status,
        "tool_name": "",
        "tool_call_id": "",
        "summary": summary,
        "detail": detail or {},
        "created_at": int(time.time()),
    }
    try:
        _ref(f"agentRuns/{run_id}/events/{event_id}").set(event)
    except Exception as exc:
        logger.warning("RTDB write_run_event failed run_id=%s event_type=%s: %s", run_id, event_type, exc)
    return event_id


def write_stream_meta(
    run_id: str,
    *,
    done: bool = False,
    chunk_count: int = 0,
    final_length: int = 0,
    response_started: bool = False,
) -> None:
    """Write assistant text stream metadata to RTDB."""
    if not _ensure_init():
        return
    try:
        _ref(f"agentRuns/{run_id}/stream_meta").set({
            "done": done,
            "chunk_count": chunk_count,
            "final_length": final_length,
            "response_started": response_started or chunk_count > 0,
            "updated_at": int(time.time()),
        })
    except Exception as exc:
        logger.warning("RTDB write_stream_meta failed run_id=%s: %s", run_id, exc)


def write_run_error(run_id: str, message: str) -> None:
    """Write a user-safe run error node for frontend failure details."""
    if not _ensure_init():
        return
    try:
        _ref(f"agentRuns/{run_id}/error").set({
            "message": message,
            "created_at": int(time.time()),
        })
    except Exception as exc:
        logger.warning("RTDB write_run_error failed run_id=%s: %s", run_id, exc)


def delete_chat_rtdb_state(chat_id: str, run_ids: list[str] | None = None) -> None:
    """Best-effort cleanup for chat/run state mirrored in RTDB."""
    if not _ensure_init():
        return
    try:
        _ref(f"chats/{chat_id}/activeRunId").delete()
    except Exception as exc:
        logger.warning("RTDB activeRunId cleanup failed chat_id=%s: %s", chat_id, exc)

    for run_id in run_ids or []:
        try:
            _ref(f"agentRuns/{run_id}").delete()
        except Exception as exc:
            logger.warning("RTDB run cleanup failed run_id=%s: %s", run_id, exc)
