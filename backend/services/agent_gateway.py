"""Agent Gateway — single source of truth for run lifecycle + Agent Engine invocation.

Every code path that triggers the agent (chat messages, lesson plan pages, assessment
pages, lab pages) goes through AgentGateway.start_chat_run().  This guarantees:

  - run_id is generated once and consistently
  - RTDB lifecycle nodes are written before the agent is invoked
  - session state (batch context + telemetry keys) is assembled from Firestore
  - the Agent Engine call is made in a background task so the HTTP response
    returns immediately with run_id
  - the final assistant message is persisted to Firestore + RTDB after streaming ends

---- RTDB path contract ----

Backend writes (owns):
  agentRuns/{run_id}/meta             run metadata
  agentRuns/{run_id}/status           running | done | failed
  chats/{chat_id}/activeRunId         current run pointer
  agentRuns/{run_id}/messages/{id}    final assistant message

Agent writes (owns):
  agentRuns/{run_id}/events/{event_id}  process / tool / thinking / retrieval / artifact
  agentRuns/{run_id}/steps/{step_id}    per-step status rows

Frontend reads:
  agentRuns/{run_id}                  (child_added on events, value on status)
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import BackgroundTasks, HTTPException, status
import os

from entity.Batch import BatchModel
from services.agent_engine_client import get_agent_engine_resource_name, stream_agent_response
from services.agent_sessions import (
    create_agent_run_record,
    ensure_chat_agent_session,
    mark_agent_run_done,
    mark_agent_run_failed,
)
from services.batch_service import get_batch
from services.chat_service import add_message
from utils.rtdb_client import create_run_meta, set_run_status, write_final_message

logger = logging.getLogger(__name__)

GOOGLE_OAUTH_REQUIRED_DETAIL = {
    "code": "GOOGLE_OAUTH_REQUIRED",
    "message": "Google OAuth connection is required for Google Workspace actions.",
    "connect_url": "/auth/google-scopes",
}


def _normalize_connectors(connectors: dict | None) -> dict[str, bool]:
    incoming = connectors or {}
    return {
        "web_search": bool(incoming.get("web_search", True)),
        "google_workspace": bool(incoming.get("google_workspace", False)),
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def start_chat_run(
    *,
    user_message: str,
    batch_id: str,
    chat_id: str,
    lecturer_id: str,
    lecturer_email: str,
    connectors: dict,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """Persist the user message, create a run, start the agent in the background.

    Returns immediately with run_id so the frontend can start listening to RTDB
    before the agent finishes.

    Response shape:
    {
        "user_message": {...},
        "run_id": "run_abc123",
        "rtdb_run_path": "agentRuns/run_abc123",
        "status": "running"
    }
    """
    connectors = _normalize_connectors(connectors)

    # --- 1. Load trusted batch context from Firestore ---
    batch = get_batch(batch_id, lecturer_id)
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Batch not found or access denied",
        )

    # --- 1b. Preflight check for Google Workspace ---
    google_oauth_status = "missing"
    if connectors.get("google_workspace"):
        from services.google_workspace.credentials import assert_google_oauth_valid, GoogleOAuthRequiredError, GoogleOAuthInvalidError
        try:
            assert_google_oauth_valid(lecturer_id)
            google_oauth_status = "valid"
        except (GoogleOAuthRequiredError, GoogleOAuthInvalidError) as exc:
            google_oauth_status = "invalid"
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=GOOGLE_OAUTH_REQUIRED_DETAIL,
            ) from exc

    agent_engine_resource_name = get_agent_engine_resource_name()

    # --- 2. Persist user message ---
    user_msg = add_message(batch_id, chat_id, "user", user_message, lecturer_id)
    agent_session_id = ensure_chat_agent_session(
        batch_id=batch_id,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
    )

    # --- 3. Create run ---
    run_id = f"run_{uuid.uuid4().hex[:16]}"
    rtdb_run_path = f"agentRuns/{run_id}"

    # --- 4. Write RTDB lifecycle nodes ---
    create_run_meta(
        run_id=run_id,
        chat_id=chat_id,
        batch_id=batch_id,
        lecturer_id=lecturer_id,
        message_preview=user_message[:200],
    )
    create_agent_run_record(
        run_id=run_id,
        batch_id=batch_id,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
        agent_session_id=agent_session_id,
        rtdb_run_path=rtdb_run_path,
        message_preview=user_message,
        agent_engine_resource_name=agent_engine_resource_name,
        connectors=connectors,
        google_oauth_status=google_oauth_status,
    )

    # --- 5. Build trusted session state for the agent ---
    session_state = _build_session_state(
        run_id=run_id,
        chat_id=chat_id,
        agent_session_id=agent_session_id,
        rtdb_run_path=rtdb_run_path,
        batch=batch,
        lecturer_id=lecturer_id,
        lecturer_email=lecturer_email,
        connectors=connectors,
        google_oauth_status=google_oauth_status,
    )

    # --- 6. Schedule background agent task ---
    background_tasks.add_task(
        _run_agent_background,
        run_id=run_id,
        rtdb_run_path=rtdb_run_path,
        batch_id=batch_id,
        chat_id=chat_id,
        agent_session_id=agent_session_id,
        lecturer_id=lecturer_id,
        user_message=user_message,
        session_state=session_state,
    )

    # --- 7. Return immediately ---
    logger.info(
        "gateway run_id=%s chat_id=%s batch_id=%s lecturer_id=%s",
        run_id, chat_id, batch_id, lecturer_id,
    )
    return {
        "user_message": user_msg,
        "run_id": run_id,
        "rtdb_run_path": rtdb_run_path,
        "status": "running",
    }


# ---------------------------------------------------------------------------
# Session state builder
# ---------------------------------------------------------------------------

def _build_session_state(
    *,
    run_id: str,
    chat_id: str,
    agent_session_id: str,
    rtdb_run_path: str,
    batch: BatchModel,
    lecturer_id: str,
    lecturer_email: str,
    connectors: dict,
    google_oauth_status: str,
) -> dict[str, Any]:
    """Build the trusted session state payload sent to the agent.

    All batch context (batch_name, course_name, datastore_id, academic_year, term)
    comes from Firestore, not the request body, so the agent always sees
    authoritative workspace context.
    """
    return {
        # Run telemetry keys
        "run_id": run_id,
        "session_id": agent_session_id,
        "chat_id": chat_id,
        "rtdb_run_path": rtdb_run_path,
        # Trusted batch context (from Firestore)
        "batch_id": batch.batch_id,
        "batch_name": batch.batch_name,
        "course_name": batch.course_name,
        "lecturer_id": lecturer_id,
        "lecturer_email": lecturer_email or batch.lecturer_email,
        "datastore_id": batch.datastore_id,
        "academic_year": batch.academic_year,
        "term": batch.term,
        # Feature flags
        "enable_web_search": connectors.get("web_search", True),
        "google_workspace_enabled": connectors.get("google_workspace", False),
        "google_oauth_status": google_oauth_status,
        "backend_internal_url": os.getenv("PNAI_BACKEND_INTERNAL_URL") or os.getenv("BACKEND_PUBLIC_URL", ""),
    }


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------

async def _run_agent_background(
    *,
    run_id: str,
    rtdb_run_path: str,
    batch_id: str,
    chat_id: str,
    agent_session_id: str,
    lecturer_id: str,
    user_message: str,
    session_state: dict[str, Any],
) -> None:
    """Stream the Agent Engine response, persist the result, update run status.

    This runs in a FastAPI background task after the HTTP response has been sent.
    The agent emits process/tool/retrieval/artifact events directly to RTDB during
    the stream.  This task owns: final text capture, Firestore persistence, and
    run status completion.
    """
    final_text_parts: list[str] = []
    try:
        async for chunk in stream_agent_response(
            user_message=user_message,
            session_id=agent_session_id,
            lecturer_id=lecturer_id,
            session_state=session_state,
        ):
            final_text_parts.append(chunk)

        final_text = "".join(final_text_parts).strip()
        if not final_text:
            raise RuntimeError("Agent Engine stream completed without any assistant text")

        # Persist assistant message to Firestore
        final_msg = add_message(batch_id, chat_id, "assistant", final_text, lecturer_id)

        # Write final message to RTDB for frontend live message display
        write_final_message(run_id, final_text)

        # Mark run complete
        try:
            mark_agent_run_done(
                batch_id=batch_id,
                chat_id=chat_id,
                run_id=run_id,
                final_message_id=str(final_msg.get("message_id") or ""),
            )
        except Exception as exc:
            logger.warning("Firestore mark done failed run_id=%s: %s", run_id, exc)
        set_run_status(run_id, "done")
        logger.info("gateway background done run_id=%s chars=%d", run_id, len(final_text))

    except Exception as exc:
        logger.error("gateway background failed run_id=%s: %s", run_id, exc)
        try:
            mark_agent_run_failed(
                batch_id=batch_id,
                chat_id=chat_id,
                run_id=run_id,
                error=str(exc),
            )
        except Exception as firestore_exc:
            logger.warning("Firestore mark failed failed run_id=%s: %s", run_id, firestore_exc)
        set_run_status(run_id, "failed")
