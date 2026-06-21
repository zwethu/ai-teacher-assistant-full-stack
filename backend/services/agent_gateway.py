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
import json
from typing import Any

from fastapi import BackgroundTasks, HTTPException, status
import os

from entity.Batch import BatchModel
from services.agent_engine_client import get_agent_engine_resource_name, stream_agent_response
from services.agent_platform_sessions import get_agent_session_state
from services.agent_sessions import (
    create_agent_run_record,
    ensure_chat_agent_session,
    mark_agent_run_done,
    mark_agent_run_draft_failed,
    mark_agent_run_draft_saved,
    mark_agent_run_failed,
)
from services.artifact_service import save_lesson_plan_draft_from_session
from services.batch_service import get_batch
from services.chat_service import add_message
from utils.rtdb_client import (
    create_run_meta,
    set_run_status,
    write_final_message,
    write_run_error,
    write_stream_delta,
    write_stream_meta,
)

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
    workflow_type: str = "",
    week: int | None = None,
    save_draft: bool = False,
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

    # --- 2. Create run id before persisting messages ---
    run_id = f"run_{uuid.uuid4().hex[:16]}"

    # --- 3. Persist user message with run_id ---
    user_msg = add_message(
        batch_id, chat_id, "user", user_message, lecturer_id, run_id=run_id,
    )
    agent_session_id = ensure_chat_agent_session(
        batch_id=batch_id,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
    )
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
        workflow_type=workflow_type,
        week=week,
        save_draft=save_draft,
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
        workflow_type=workflow_type,
        week=week,
        save_draft=save_draft,
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
    workflow_type: str = "",
    week: int | None = None,
    save_draft: bool = False,
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
        "workflow_type": workflow_type,
        "requested_week": week,
        "save_draft": save_draft,
    }


def safe_run_error_message(exc: Exception) -> str:
    """Map backend/stream exceptions to short user-safe messages."""
    text = str(exc).lower()
    if "oauth" in text or "google workspace" in text:
        return "Google Workspace needs to be connected before this action can continue."
    if "no assistant text" in text or "no final" in text:
        return "The Agent Engine stream finished without a final assistant response."
    if "agent engine" in text and any(word in text for word in ("auth", "credential", "permission", "forbidden", "unauthorized")):
        return "The Agent Engine credentials or permissions need attention."
    if "failed to parse response as json" in text or "unknownapiresponseerror" in text:
        return "The Agent Engine SDK could not parse the streaming response."
    if "agent engine" in text or "async_stream_query" in text:
        return "The Agent Engine stream failed before producing a final response."
    if "rtdb" in text or "realtime database" in text:
        return "Live updates were unavailable while the agent was running."
    return "Unexpected backend error."


def extract_lesson_plan_full_from_state(state: dict[str, Any]) -> dict[str, Any] | None:
    """Return a plausible LessonPlanFull payload from Agent Platform state."""
    active_type = str(state.get("active_artifact_type") or "").strip()
    if active_type and active_type != "lesson_plan":
        return None

    raw = state.get("lesson_plan_full")
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    elif hasattr(raw, "model_dump"):
        raw = raw.model_dump(mode="json")

    if not isinstance(raw, dict):
        return None

    title = str(raw.get("title") or "").strip()
    subject = str(raw.get("subject") or raw.get("course_name") or "").strip()
    week = raw.get("week")
    objectives = raw.get("objectives")
    timeline = raw.get("detailed_timeline")
    try:
        week_int = int(week)
    except (TypeError, ValueError):
        return None
    if not title or week_int < 1 or not subject:
        return None
    if not objectives and not timeline:
        return None
    return raw


def _draft_message_metadata(draft: dict[str, Any] | None) -> dict[str, Any]:
    if not draft:
        return {}
    return {
        "draft_artifact_id": str(draft.get("id") or draft.get("artifact_id") or ""),
        "artifact_type": "lesson_plan",
        "week": draft.get("week"),
        "exportable": True,
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
    chunk_index = 0
    streamed_length = 0

    try:
        async for chunk in stream_agent_response(
            user_message=user_message,
            session_id=agent_session_id,
            lecturer_id=lecturer_id,
            session_state=session_state,
        ):
            if not chunk:
                continue
            final_text_parts.append(chunk)
            write_stream_delta(run_id, chunk_index, chunk)
            chunk_index += 1
            streamed_length += len(chunk)
            write_stream_meta(
                run_id,
                done=False,
                chunk_count=chunk_index,
                final_length=streamed_length,
            )

        final_text = "".join(final_text_parts).strip()
        write_stream_meta(
            run_id,
            done=True,
            chunk_count=chunk_index,
            final_length=len(final_text),
        )
        if not final_text:
            raise RuntimeError("Agent Engine stream completed without any assistant text")

        metadata: dict[str, Any] = {}
        try:
            session_state_after = await get_agent_session_state(
                resource_name=get_agent_engine_resource_name(),
                user_id=lecturer_id,
                session_id=agent_session_id,
            )
            lesson_plan_payload = extract_lesson_plan_full_from_state(session_state_after)
            if lesson_plan_payload:
                draft = save_lesson_plan_draft_from_session(
                    batch_id=batch_id,
                    lecturer_id=lecturer_id,
                    chat_id=chat_id,
                    run_id=run_id,
                    lesson_plan_payload=lesson_plan_payload,
                    rendered_markdown=final_text,
                    lecturer_email=str(
                        session_state_after.get("lecturer_email")
                        or session_state.get("lecturer_email")
                        or ""
                    ),
                )
                metadata = _draft_message_metadata(draft)
                mark_agent_run_draft_saved(
                    batch_id=batch_id,
                    chat_id=chat_id,
                    run_id=run_id,
                    artifact_id=str(metadata.get("draft_artifact_id") or ""),
                    week=draft.get("week"),
                )
                logger.info(
                    "lesson plan draft saved run_id=%s artifact_id=%s week=%s",
                    run_id,
                    metadata.get("draft_artifact_id"),
                    metadata.get("week"),
                )
        except Exception as draft_exc:
            logger.warning(
                "Lesson plan generated, but draft artifact save failed run_id=%s: %s",
                run_id,
                draft_exc,
            )
            try:
                mark_agent_run_draft_failed(
                    batch_id=batch_id,
                    chat_id=chat_id,
                    run_id=run_id,
                    error=str(draft_exc),
                )
            except Exception as mark_exc:
                logger.warning(
                    "Firestore draft failure marker failed run_id=%s: %s",
                    run_id,
                    mark_exc,
                )

        # Persist assistant message to Firestore
        final_msg = add_message(
            batch_id,
            chat_id,
            "assistant",
            final_text,
            lecturer_id,
            run_id=run_id,
            metadata=metadata,
        )

        # Write final message to RTDB for frontend live message display
        write_final_message(run_id, final_text, metadata=metadata)

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
            write_stream_meta(
                run_id,
                done=True,
                chunk_count=chunk_index,
                final_length=len("".join(final_text_parts)),
            )
        except Exception as stream_exc:
            logger.warning("RTDB stream meta failure failed run_id=%s: %s", run_id, stream_exc)
        safe_error = safe_run_error_message(exc)
        final_error = (
            "The agent run failed before producing a final response. "
            f"Error: {safe_error}"
        )
        try:
            mark_agent_run_failed(
                batch_id=batch_id,
                chat_id=chat_id,
                run_id=run_id,
                error=safe_error,
            )
        except Exception as firestore_exc:
            logger.warning("Firestore mark failed failed run_id=%s: %s", run_id, firestore_exc)
        try:
            add_message(
                batch_id, chat_id, "assistant", final_error, lecturer_id, run_id=run_id,
            )
        except Exception as message_exc:
            logger.warning("Firestore failure message write failed run_id=%s: %s", run_id, message_exc)
        write_run_error(run_id, safe_error)
        write_final_message(run_id, final_error)
        set_run_status(run_id, "failed")
