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
) -> None:
    """Write initial run metadata and set status=running."""
    if not _ensure_init():
        return
    try:
        now = int(time.time())
        run_path = f"agentRuns/{run_id}"
        _ref(f"{run_path}/meta").set({
            "run_id": run_id,
            "rtdb_run_path": run_path,
            "chat_id": chat_id,
            "batch_id": batch_id,
            "lecturer_id": lecturer_id,
            "message_preview": message_preview[:200],
            "created_at": now,
        })
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


def write_final_message(
    run_id: str,
    content: str,
    role: str = "assistant",
    metadata: dict | None = None,
) -> None:
    """Push the final assistant message into agentRuns/{run_id}/messages."""
    if not _ensure_init():
        return
    try:
        import uuid
        msg_id = uuid.uuid4().hex[:16]
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


def write_stream_delta(run_id: str, index: int, delta: str) -> None:
    """Write one assistant text stream chunk to RTDB."""
    if not delta:
        return
    if not _ensure_init():
        return
    try:
        key = f"{index:06d}"
        _ref(f"agentRuns/{run_id}/stream_deltas/{key}").set({
            "index": index,
            "delta": delta,
            "created_at": int(time.time()),
        })
    except Exception as exc:
        logger.warning("RTDB write_stream_delta failed run_id=%s index=%s: %s", run_id, index, exc)


def write_stream_meta(
    run_id: str,
    *,
    done: bool = False,
    chunk_count: int = 0,
    final_length: int = 0,
) -> None:
    """Write assistant text stream metadata to RTDB."""
    if not _ensure_init():
        return
    try:
        _ref(f"agentRuns/{run_id}/stream_meta").set({
            "done": done,
            "chunk_count": chunk_count,
            "final_length": final_length,
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
