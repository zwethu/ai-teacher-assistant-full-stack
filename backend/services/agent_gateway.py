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

import asyncio
from contextlib import aclosing
import json
import logging
import time
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import BackgroundTasks, HTTPException, status

from entity.Batch import BatchModel
from entity.CourseBlueprint import CourseBlueprintContent
from entity.GameSession import MAX_GAME_ITEMS, MIN_GAME_ITEMS
from services.agent_engine_client import get_agent_engine_resource_name, stream_agent_response
from services.agent_platform_sessions import get_agent_session_state
from services.agent_artifact_context import build_agent_artifact_manifest
from services.artifact_sync_service import preflight_sync_artifacts_for_agent_run
from services.agent_sessions import (
    is_agent_run_cancelled,
    claim_run_dispatch,
    create_agent_run_record,
    ensure_chat_agent_session,
    list_runs_awaiting_attachments,
    mark_agent_run_awaiting_attachments,
    mark_agent_run_done,
    mark_agent_run_draft_failed,
    mark_agent_run_draft_saved,
    mark_agent_run_failed,
    mark_agent_run_pending_artifact,
    mark_agent_run_outline_ready,
    persist_agent_run_timeline,
    read_run_doc,
    refresh_run_attachment_context,
    stash_run_dispatch,
)
from services.artifact_service import (
    content_hash,
    render_preview_markdown,
    save_lab_draft_from_session,
    save_lesson_plan_draft_from_session,
    save_quiz_draft_from_session,
)
from services.batch_service import get_batch
from services.chat_service import add_message, add_user_message_with_attachments, get_message_run_id
from services.chat_attachment_service import (
    all_attachments_settled,
    fail_stuck_attachment,
    get_attachment_status_and_message,
    list_live_attachment_docs,
)
from services.cloud_tasks import QUEUE_RUNS, enqueue
from services.course_blueprint_service import (
    build_blueprint_session_context,
    build_blueprint_status_context,
    is_generation_workflow,
)
from utils.rtdb_client import (
    create_run_meta,
    finalize_open_run_steps,
    read_run_timeline_snapshot,
    set_run_status,
    write_final_message,
    write_run_error,
    write_run_event,
    write_stream_delta,
    write_stream_meta,
)

logger = logging.getLogger(__name__)

# How often the streaming loop checks whether the lecturer pressed Stop.
# Responsive enough to feel immediate, cheap enough to not matter.
CANCEL_POLL_SECONDS = 1.5


def _normalize_connectors(connectors: dict | None) -> dict[str, bool]:
    incoming = connectors or {}
    return {
        "web_search": bool(incoming.get("web_search", True)),
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
    pending_artifact: bool = False,
    workflow_stage: str = "",
    approval_action: str = "",
    approved_outline_run_id: str = "",
    approved_outline: dict[str, Any] | None = None,
    attachment_ids: list[str] | None = None,
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
    preflight_start = time.perf_counter()
    connectors = _normalize_connectors(connectors)

    # --- 1. Load trusted batch context from Firestore ---
    batch = get_batch(batch_id, lecturer_id)
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Batch not found or access denied",
        )

    agent_engine_resource_name = get_agent_engine_resource_name()

    # --- 2. Create run id before persisting messages ---
    run_id = f"run_{uuid.uuid4().hex[:16]}"
    try:
        artifact_sync_preflight = preflight_sync_artifacts_for_agent_run(
            batch_id=batch_id,
            lecturer_id=lecturer_id,
            workflow_type=workflow_type,
            week=week,
            user_message=user_message,
        )
    except Exception as exc:
        logger.exception("artifact sync preflight failed run_id=%s", run_id)
        artifact_sync_preflight = {
            "status": "failed",
            "summary": "Artifact sync preflight failed; using saved Firestore content.",
            "items": [{"status": "sync_failed", "error": str(exc)[:1000]}],
        }

    # --- 3. Persist user message with run_id ---
    try:
        user_msg, attachment_records = add_user_message_with_attachments(
            batch_id=batch_id, chat_id=chat_id, content=user_message,
            lecturer_id=lecturer_id, run_id=run_id, attachment_ids=attachment_ids,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    agent_session_id, session_existed = ensure_chat_agent_session(
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
        artifact_sync_preflight=artifact_sync_preflight,
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
        workflow_type=workflow_type,
        week=week,
        save_draft=save_draft,
        pending_artifact=pending_artifact,
        workflow_stage=workflow_stage,
        approval_action=approval_action,
        approved_outline_run_id=approved_outline_run_id,
        artifact_sync_preflight=artifact_sync_preflight,
    )

    # --- 5. Build trusted session state and stash it for the agent-run task ---
    session_state = _build_session_state(
        run_id=run_id,
        chat_id=chat_id,
        agent_session_id=agent_session_id,
        rtdb_run_path=rtdb_run_path,
        batch=batch,
        lecturer_id=lecturer_id,
        lecturer_email=lecturer_email,
        connectors=connectors,
        workflow_type=workflow_type,
        week=week,
        save_draft=save_draft,
        pending_artifact=pending_artifact,
        workflow_stage=workflow_stage,
        approval_action=approval_action,
        approved_outline_run_id=approved_outline_run_id,
        approved_outline=approved_outline,
        artifact_sync_preflight=artifact_sync_preflight,
        attachment_records=attachment_records,
    )
    stash_run_dispatch(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        session_state=session_state, user_message=user_message,
        session_assume_exists=session_existed,
    )

    # --- 6. Dispatch now, or defer until attachments finish processing ---
    pending_ids = [
        str(a.get("attachment_id") or "")
        for a in (attachment_records or [])
        if str(a.get("status") or "") == "processing"
    ]
    run_status = "running"
    if pending_ids:
        # Deferred run: hold until /tasks/process-attachment reports all ready.
        # UI shows "Processing your file(s)…".
        timeout_minutes = _processing_timeout_minutes()
        deadline = datetime.now(timezone.utc) + timedelta(minutes=timeout_minutes)
        mark_agent_run_awaiting_attachments(
            batch_id=batch_id, chat_id=chat_id, run_id=run_id,
            attachment_ids=pending_ids, deadline=deadline,
        )
        set_run_status(run_id, "awaiting_attachments")
        run_status = "awaiting_attachments"
        # The deadline is known exactly here, so schedule the timeout check for this
        # one run instead of sweeping every run's status once a minute forever. The
        # handler no-ops if the attachments settled first, and claim_run_dispatch
        # makes a race with the settle path safe either way.
        enqueue(
            QUEUE_RUNS, "/tasks/attachment-deadline",
            {"batch_id": batch_id, "chat_id": chat_id, "run_id": run_id},
            delay_seconds=timeout_minutes * 60,
        )
    else:
        dispatch_agent_run(batch_id, chat_id, run_id, background_tasks=background_tasks)

    # --- 7. Return immediately ---
    logger.info(
        "gateway run_id=%s chat_id=%s batch_id=%s lecturer_id=%s status=%s pending_attachments=%d "
        "event=preflight_total duration_ms=%d",
        run_id, chat_id, batch_id, lecturer_id, run_status, len(pending_ids),
        int((time.perf_counter() - preflight_start) * 1000),
    )
    return {
        "user_message": user_msg,
        "run_id": run_id,
        "rtdb_run_path": rtdb_run_path,
        "status": run_status,
    }


def _processing_timeout_minutes() -> int:
    try:
        return max(1, min(int(os.getenv("CHAT_ATTACHMENT_PROCESSING_TIMEOUT_MINUTES", "5")), 60))
    except (TypeError, ValueError):
        return 5


def dispatch_agent_run(batch_id: str, chat_id: str, run_id: str, *, background_tasks=None) -> None:
    """Enqueue the agent-run task (durable via Cloud Tasks; inline locally)."""
    enqueue(
        QUEUE_RUNS, "/tasks/run-agent",
        {"batch_id": batch_id, "chat_id": chat_id, "run_id": run_id},
        background_tasks=background_tasks,
    )


async def run_agent_task(batch_id: str, chat_id: str, run_id: str) -> None:
    """Agent-run task handler: once-only claim, then stream from the stashed payload."""
    if not claim_run_dispatch(batch_id=batch_id, chat_id=chat_id, run_id=run_id):
        logger.info("run_agent_task: run_id=%s already dispatched/terminal — skipping", run_id)
        return
    set_run_status(run_id, "running")
    # First working note, immediately. The agent's own thinking events only start
    # after the session round-trip + its first model turn (~5-10s), and a plain
    # chat turn may never emit one — without this the panel shows the bare
    # "Waiting for agent working notes..." placeholder for the whole gap.
    write_run_event(
        run_id,
        event_type="backend.run.started",
        kind="thinking",
        status="running",
        title="Reading your request…",
        summary="Reading your request…",
        # mode=status lets the panel show this while running but drop it from
        # the post-completion "Thought for Ns" summary.
        detail={"mode": "status"},
        batch_id=batch_id,
        chat_id=chat_id,
    )
    run = read_run_doc(batch_id=batch_id, chat_id=chat_id, run_id=run_id) or {}
    payload = run.get("dispatch_payload") or {}
    await _run_agent_background(
        run_id=run_id,
        rtdb_run_path=str(run.get("rtdb_run_path") or f"agentRuns/{run_id}"),
        batch_id=batch_id,
        chat_id=chat_id,
        agent_session_id=str(run.get("agent_session_id") or ""),
        lecturer_id=str(run.get("lecturer_id") or ""),
        user_message=str(payload.get("user_message") or ""),
        session_state=payload.get("session_state") or {},
        session_assume_exists=bool(payload.get("session_assume_exists")),
    )


def on_attachment_settled(batch_id: str, chat_id: str, attachment_id: str, *, background_tasks=None) -> None:
    """Called after an attachment reaches ready/failed/too_large. If it unblocks a
    deferred run whose files are now all settled, refresh the manifest and dispatch."""
    _status, message_id = get_attachment_status_and_message(batch_id, chat_id, attachment_id)
    if not message_id:
        return  # unsent attachment — no run waiting on it
    run_id = get_message_run_id(batch_id, chat_id, message_id)
    if not run_id:
        return
    run = read_run_doc(batch_id=batch_id, chat_id=chat_id, run_id=run_id) or {}
    if run.get("status") != "awaiting_attachments":
        return
    awaited = [str(a) for a in (run.get("awaiting_attachment_ids") or [])]
    if not all_attachments_settled(batch_id, chat_id, awaited):
        return  # still waiting on siblings
    _refresh_and_dispatch(batch_id, chat_id, run_id, background_tasks=background_tasks)


def _refresh_and_dispatch(batch_id: str, chat_id: str, run_id: str, *, background_tasks=None) -> None:
    """Rebuild the attachment manifest (files now settled) into the stashed state, dispatch."""
    run = read_run_doc(batch_id=batch_id, chat_id=chat_id, run_id=run_id) or {}
    lecturer_id = str(run.get("lecturer_id") or "")
    records = [
        item for item in list_live_attachment_docs(batch_id, chat_id, lecturer_id, limit=50)
        if str(item.get("message_id") or "") and str(item.get("attachment_id") or "") in
        {str(a) for a in (run.get("awaiting_attachment_ids") or [])}
    ]
    attachment_context = build_chat_attachment_context(
        records, batch_id=batch_id, chat_id=chat_id, lecturer_id=lecturer_id
    )
    refresh_run_attachment_context(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id, attachment_context=attachment_context
    )
    dispatch_agent_run(batch_id, chat_id, run_id, background_tasks=background_tasks)


def release_run_past_deadline(batch_id: str, chat_id: str, run_id: str) -> bool:
    """Time out one deferred run: fail whatever is still processing and dispatch it
    degraded, rather than leaving the lecturer's message stuck forever.

    Idempotent, and safe to arrive late — a run that settled normally, was cancelled,
    or already ran is no longer ``awaiting_attachments`` and this is a no-op.
    """
    run = read_run_doc(batch_id=batch_id, chat_id=chat_id, run_id=run_id) or {}
    if run.get("status") != "awaiting_attachments":
        return False
    deadline = _as_datetime(run.get("awaiting_deadline"))
    if deadline and deadline > datetime.now(timezone.utc):
        return False  # re-armed or delivered early; the later task still covers it
    for attachment_id in (run.get("awaiting_attachment_ids") or []):
        fail_stuck_attachment(batch_id, chat_id, str(attachment_id))
    _refresh_and_dispatch(batch_id, chat_id, run_id)
    return True


def _as_datetime(value: Any) -> datetime | None:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return value if isinstance(value, datetime) else None


def run_attachment_watchdog(limit: int = 50) -> int:
    """Backstop sweep for deferred runs whose per-run deadline task never arrived.

    Each deferred run schedules its own timeout via /tasks/attachment-deadline, so
    this is no longer the primary path — it only covers a dropped task, and local
    dev, where delayed dispatch is a threading.Timer that dies with the process.
    """
    dispatched = 0
    for run in list_runs_awaiting_attachments(limit=limit):
        if release_run_past_deadline(
            str(run.get("batch_id") or ""),
            str(run.get("chat_id") or ""),
            str(run.get("run_id") or ""),
        ):
            dispatched += 1
    return dispatched


# ---------------------------------------------------------------------------
# Session state builder
# ---------------------------------------------------------------------------

def _legacy_attachment_context_enabled() -> bool:
    """Compat window: legacy 30k text blob until the native agent path is verified."""
    return (os.getenv("CHAT_ATTACHMENT_LEGACY_CONTEXT") or "true").strip().lower() != "false"


def _manifest_entry(item: dict[str, Any], current_ids: set[str]) -> dict[str, Any]:
    """One trusted manifest entry. gcs_uri is consumed by agent TOOL CODE only —
    session_context never renders the manifest into prompts."""
    attachment_id = str(item.get("attachment_id") or "")
    kind = str(item.get("attachment_kind") or "other")
    native_uri = str(item.get("extracted_text_path") or "") or str(item.get("gcs_path") or "")
    native_mime = "text/plain" if item.get("extracted_text_path") else str(item.get("content_type") or "")
    return {
        "attachment_id": attachment_id,
        "message_id": str(item.get("message_id") or ""),
        "file_name": str(item.get("file_name") or "attachment"),
        "file_title": str(item.get("file_title") or item.get("file_name") or ""),
        "attachment_kind": kind,
        "content_type": str(item.get("content_type") or ""),
        "status": str(item.get("status") or "processing"),
        "gcs_uri": native_uri,
        "native_mime_type": native_mime,
        "raw_gcs_uri": str(item.get("gcs_path") or ""),
        "token_estimate": int(item.get("token_estimate") or 0),
        "expires_at": item.get("expires_at").isoformat() if hasattr(item.get("expires_at"), "isoformat") else (str(item.get("expires_at")) if item.get("expires_at") else None),
        "is_current_message": attachment_id in current_ids,
        "chat_only": kind == "image",
        "parse_status": str(item.get("parse_status") or "skipped"),
        "vision_status": str(item.get("vision_status") or "skipped"),
        # Cached vision fields keep the image tool's fallback path working.
        "vision_summary": str(item.get("vision_summary") or "")[:4000] if kind == "image" else "",
        "ocr_text": str(item.get("ocr_text") or "")[:4000] if kind == "image" else "",
        "vision_error": str(item.get("vision_error") or "")[:300] if kind == "image" else "",
        "vision_source": str(item.get("vision_source") or "none") if kind == "image" else "none",
    }


def build_chat_attachment_context(
    records: list[dict[str, Any]] | None,
    *,
    batch_id: str = "",
    chat_id: str = "",
    lecturer_id: str = "",
) -> dict[str, Any]:
    """Trusted attachment state for the run: manifest (current-message records +
    retained live chat attachments) and a bounded text context.

    Ownership is validated HERE, once — agent tools consume the manifest and do
    not re-query Firestore. This is the single trust boundary (design doc §2.2).
    """
    from services.attachment_constants import (
        MAX_AGENT_ATTACHMENT_CONTEXT_CHARS,
        MAX_AGENT_CONTEXT_PER_ATTACHMENT_CHARS,
    )

    current_records = list(records or [])
    current_ids = {str(item.get("attachment_id") or "") for item in current_records}
    manifest = [_manifest_entry(item, current_ids) for item in current_records]

    if batch_id and chat_id and lecturer_id:
        try:
            from services.chat_attachment_service import list_live_attachment_docs
            for item in list_live_attachment_docs(batch_id, chat_id, lecturer_id, limit=50):
                if str(item.get("attachment_id") or "") in current_ids:
                    continue
                manifest.append(_manifest_entry(item, current_ids))
        except Exception:
            logger.exception("Failed to list retained chat attachments chat_id=%s", chat_id)

    blocks: list[str] = []
    if _legacy_attachment_context_enabled():
        remaining = MAX_AGENT_ATTACHMENT_CONTEXT_CHARS
        for item in current_records:
            kind = str(item.get("attachment_kind") or "other")
            lines = [
                f"Attachment: {item.get('file_name') or 'attachment'}",
                f"Attachment ID: {item.get('attachment_id') or ''}",
                f"Type: {kind} ({item.get('content_type') or 'unknown'})",
            ]
            if kind == "image":
                lines.append("Scope: chat-only. This image is not saved to Course Space and cannot be promoted.")
                if item.get("vision_summary"):
                    lines.append(f"Vision summary: {item['vision_summary']}")
                if item.get("ocr_text"):
                    lines.append(f"OCR text: {item['ocr_text']}")
                if str(item.get("vision_status") or "") != "ready":
                    lines.append("Image visual content is unavailable. Do not infer image content from course materials or prior context.")
            elif item.get("extracted_text_preview"):
                lines.append(f"Extracted preview: {item['extracted_text_preview']}")
            block = "\n".join(lines)
            truncated = len(block) > MAX_AGENT_CONTEXT_PER_ATTACHMENT_CHARS
            block = block[:MAX_AGENT_CONTEXT_PER_ATTACHMENT_CHARS]
            if truncated:
                block += "\n[Attachment context truncated]"
            if len(block) > remaining:
                if remaining > 80:
                    blocks.append(block[:remaining - 40] + "\n[Total attachment context truncated]")
                break
            blocks.append(block)
            remaining -= len(block) + 2
    else:
        # Native path: one summary line per current-message file; the agent
        # reads content via read_chat_attachment, not pre-stuffed text.
        for entry in manifest:
            if not entry["is_current_message"]:
                continue
            blocks.append(
                f"- {entry['file_name']} ({entry['attachment_kind']}, ~{entry['token_estimate']} tokens, "
                f"status: {entry['status']}, id: {entry['attachment_id']})"
            )

    return {
        "current_chat_attachment_ids": [str(item.get("attachment_id") or "") for item in current_records],
        "current_chat_attachments_manifest": manifest,
        "current_chat_attachment_context": "\n\n".join(blocks) if _legacy_attachment_context_enabled() else "\n".join(blocks),
    }


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
    workflow_type: str = "",
    week: int | None = None,
    save_draft: bool = False,
    pending_artifact: bool = False,
    workflow_stage: str = "",
    approval_action: str = "",
    approved_outline_run_id: str = "",
    approved_outline: dict[str, Any] | None = None,
    artifact_sync_preflight: dict[str, Any] | None = None,
    attachment_records: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the trusted session state payload sent to the agent.

    All batch context (batch_name, course_name, datastore_id, academic_year, term)
    comes from Firestore, not the request body, so the agent always sees
    authoritative workspace context.
    """
    state = {
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
        # Per-run web evidence must never leak forward from the long-lived session.
        "web_search_status": "not_run",
        "last_web_search": {},
        "last_web_research_request": "",
        "last_web_grounding_structured": {},
        "last_web_grounding_raw_preview": {},
        "workflow_type": workflow_type,
        "requested_week": week,
        "save_draft": save_draft,
        "pending_artifact": pending_artifact,
        "workflow_stage": workflow_stage,
        "approval_action": approval_action,
        "approved_outline_run_id": approved_outline_run_id,
        "artifact_sync_status": (artifact_sync_preflight or {}).get("status", ""),
        "artifact_sync_summary": (artifact_sync_preflight or {}).get("summary", ""),
        "artifact_manifest": build_agent_artifact_manifest(
            batch_id=batch.batch_id,
            lecturer_id=lecturer_id,
        ),
        "active_course_blueprint_id": "",
        "active_course_blueprint_version": 0,
        "course_blueprint_status": "none",
        "course_blueprint_summary": "",
        "course_blueprint_week_plan": {},
        "course_blueprint_assessment_strategy": "",
        "course_blueprint_lab_strategy": "",
        "course_blueprint_teaching_preferences": {},
    }
    state.update(build_chat_attachment_context(
        attachment_records,
        batch_id=batch.batch_id, chat_id=chat_id, lecturer_id=lecturer_id,
    ))
    # Interim native-read manifest for just-uploaded course files still indexing.
    try:
        from services.file_service import build_pending_course_materials_manifest
        state["pending_course_materials_manifest"] = build_pending_course_materials_manifest(
            batch.batch_id, lecturer_id
        )
    except Exception:
        logger.exception("Failed to build pending course materials manifest batch=%s", batch.batch_id)
        state["pending_course_materials_manifest"] = []
    if is_generation_workflow(workflow_type):
        state.update(
            build_blueprint_session_context(
                batch.batch_id, lecturer_id, requested_week=week
            )
        )
    else:
        state.update(build_blueprint_status_context(batch.batch_id, lecturer_id))
    if approved_outline:
        artifact_type = str(approved_outline.get("outline_artifact_type") or "")
        key = {
            "lesson_plan": "lesson_plan_outline",
            "lab": "lab_outline",
            "quiz": "quiz_outline",
            "course_blueprint": "course_blueprint_outline",
        }.get(artifact_type)
        if key and isinstance(approved_outline.get("outline_payload"), dict):
            state[key] = approved_outline["outline_payload"]
        context = approved_outline.get("outline_context")
        if isinstance(context, dict):
            state.update(context)
    return state


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


def _artifact_staged_this_run(state: dict[str, Any], stamp_key: str) -> bool:
    """Run-scope guard: the agent stamps outline/generation payloads with the run
    that produced them (capture_agent_step). Session state is long-lived per chat,
    so a stale payload from an earlier run must never be extracted as this run's
    result — the same contract email/game already enforce via staged_in_run."""
    run_id = str(state.get("run_id") or "")
    return bool(run_id) and str(state.get(stamp_key) or "") == run_id


def extract_lesson_plan_full_from_state(state: dict[str, Any]) -> dict[str, Any] | None:
    """Return a plausible LessonPlanFull payload from Agent Platform state."""
    active_type = str(state.get("active_artifact_type") or "").strip()
    if active_type and active_type != "lesson_plan":
        return None
    if not _artifact_staged_this_run(state, "generation_staged_in_run"):
        return None

    raw = _state_payload(state, "lesson_plan_full")
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


def extract_lab_full_from_state(state: dict[str, Any]) -> dict[str, Any] | None:
    """Return a plausible LabFull payload from Agent Platform state."""
    active_type = str(state.get("active_artifact_type") or "").strip()
    if active_type and active_type != "lab":
        return None
    if not _artifact_staged_this_run(state, "generation_staged_in_run"):
        return None

    raw = _state_payload(state, "lab_full")
    if not isinstance(raw, dict):
        return None

    title = str(raw.get("title") or "").strip()
    topic = str(raw.get("topic") or "").strip()
    week = raw.get("week")
    procedure_steps = raw.get("procedure_steps")
    objectives = raw.get("learning_objectives")
    try:
        week_int = int(week)
    except (TypeError, ValueError):
        return None
    if not title or week_int < 1 or not topic:
        return None
    if not procedure_steps and not objectives:
        return None
    return raw


def extract_quiz_full_from_state(state: dict[str, Any]) -> dict[str, Any] | None:
    """Return a plausible QuizFull payload from Agent Platform state."""
    active_type = str(state.get("active_artifact_type") or "").strip()
    if active_type and active_type not in {"quiz", "assessment"}:
        return None
    if not _artifact_staged_this_run(state, "generation_staged_in_run"):
        return None

    raw = _state_payload(state, "quiz_full")
    if not isinstance(raw, dict):
        return None

    title = str(raw.get("title") or "").strip()
    week = raw.get("week")
    questions = raw.get("questions")
    try:
        week_int = int(week)
    except (TypeError, ValueError):
        return None
    if not title or week_int < 1:
        return None
    if not isinstance(questions, list) or not questions:
        return None
    return raw


def extract_course_blueprint_full_from_state(state: dict[str, Any]) -> dict[str, Any] | None:
    """Return a plausible CourseBlueprintRecommendation payload (course-level, no week)."""
    active_type = str(state.get("active_artifact_type") or "").strip()
    if active_type and active_type != "course_blueprint":
        return None
    if not _artifact_staged_this_run(state, "generation_staged_in_run"):
        return None
    raw = _state_payload(state, "course_blueprint_full")
    if not isinstance(raw, dict):
        return None
    raw = dict(raw)
    preferences = raw.get("teaching_preferences")
    if isinstance(preferences, list):
        normalized_preferences: dict[str, str] = {}
        for item in preferences[:50]:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            value = str(item.get("value") or "").strip()
            if key and value:
                normalized_preferences[key[:200]] = value[:2000]
        raw["teaching_preferences"] = normalized_preferences
    title = str(raw.get("title") or "").strip()
    scope = str(raw.get("plan_scope") or "").strip()
    if not title or not scope:
        return None
    if not (raw.get("summary") or raw.get("weekly_plan") or raw.get("assessment_strategy") or raw.get("lab_strategy")):
        return None
    return raw


def extract_game_full_from_state(
    state: dict[str, Any], run_id: str
) -> dict[str, Any] | None:
    """Return a term/definition game staged by the game agent, only if THIS run staged it.

    Same run-scoped guard as ``extract_email_full_from_state``: session state is
    long-lived per chat, so a stale ``game_full`` must never resurface a "Create game"
    button on an unrelated message. The game agent stamps ``staged_in_run`` in
    stage_game_session; we require it to match the run being finalized.

    The agent already validated against GameFull, but this is agent-authored input on
    the way into a backend write, so the pairs are re-cleaned and re-bounded here.
    """
    active_type = str(state.get("active_artifact_type") or "").strip()
    if active_type and active_type != "game":
        return None

    raw = _state_payload(state, "game_full")
    if not isinstance(raw, dict):
        return None
    if str(raw.get("staged_in_run") or "") != str(run_id or ""):
        return None

    title = str(raw.get("title") or "").strip()
    if not title:
        return None

    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in raw.get("items") or []:
        if not isinstance(entry, dict):
            continue
        term = str(entry.get("term") or "").strip()
        definition = str(entry.get("definition") or "").strip()
        if not term or not definition:
            continue
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        items.append({"term": term, "definition": definition})

    if len(items) < MIN_GAME_ITEMS:
        return None
    return {"title": title, "items": items[:MAX_GAME_ITEMS]}


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def extract_email_full_from_state(
    state: dict[str, Any], run_id: str
) -> dict[str, Any] | None:
    """Return an email staged by the email agent, only if THIS run staged it.

    Session state is long-lived per chat, so a stale ``email_full`` from an earlier
    turn must never resurface send buttons on an unrelated message. The email agent
    stamps ``staged_in_run`` with the current run id (via stage_email_for_send); we
    require it to match the run being finalized.
    """
    raw = _state_payload(state, "email_full")
    if not isinstance(raw, dict):
        return None
    if str(raw.get("staged_in_run") or "") != str(run_id or ""):
        return None

    recipients_raw = raw.get("recipients")
    if isinstance(recipients_raw, str):
        recipients_raw = [recipients_raw]
    recipients: list[str] = []
    for item in recipients_raw or []:
        addr = str(item).strip()
        if addr and _EMAIL_RE.match(addr) and addr not in recipients:
            recipients.append(addr)

    subject = str(raw.get("subject") or "").strip()
    body = str(raw.get("body") or "").strip()
    if not recipients or not subject or not body:
        return None
    return {"recipients": recipients, "subject": subject, "body": body}


def extract_outline_from_state(
    state: dict[str, Any], workflow_type: str
) -> tuple[str, dict[str, Any]] | None:
    normalized = workflow_type.strip().lower()
    artifact_type = (
        "lesson_plan" if normalized.startswith("lesson_plan")
        else "lab" if normalized.startswith("lab")
        else "quiz" if normalized.startswith(("assessment", "quiz"))
        else "course_blueprint" if normalized.startswith("course_blueprint")
        else ""
    )
    key = {
        "lesson_plan": "lesson_plan_outline", "lab": "lab_outline",
        "quiz": "quiz_outline", "course_blueprint": "course_blueprint_outline",
    }.get(artifact_type)
    if key and not _artifact_staged_this_run(state, "outline_staged_in_run"):
        return None
    payload = _state_payload(state, key) if key else None
    if not payload or not str(payload.get("title") or "").strip():
        return None
    # Course planning is course-level — no week to validate.
    if artifact_type != "course_blueprint":
        try:
            if int(payload.get("week")) < 1:
                return None
        except (TypeError, ValueError):
            return None
    return artifact_type, payload


def render_outline_markdown(artifact_type: str, payload: dict[str, Any]) -> str:
    title = str(payload.get("title") or "Generated outline")
    if artifact_type == "course_blueprint":
        lines = [f"# {title}", ""]
        if payload.get("summary"):
            lines += [str(payload["summary"]), ""]
        scope = str(payload.get("plan_scope") or "")
        horizon = payload.get("planning_horizon_weeks")
        meta = [m for m in (f"**Scope:** {scope}" if scope else "", f"**Weeks:** {horizon}" if horizon else "") if m]
        if meta:
            lines += [" · ".join(meta), ""]
        themes = payload.get("weekly_themes")
        if isinstance(themes, list) and themes:
            lines += ["## Weekly Themes", ""]
            for t in themes:
                if isinstance(t, dict):
                    lines.append(f"- **Week {t.get('week')}:** {str(t.get('theme') or '')}")
            lines.append("")
        if payload.get("assessment_strategy_summary"):
            lines += ["## Assessment Strategy", str(payload["assessment_strategy_summary"]), ""]
        if payload.get("lab_strategy_summary"):
            lines += ["## Lab Strategy", str(payload["lab_strategy_summary"]), ""]
        return "\n".join(lines).strip()
    lines = [f"# {title}", "", f"**Week:** {payload.get('week')}", ""]
    if artifact_type == "lesson_plan":
        lines.extend([
            f"**Subject:** {payload.get('subject', '')}",
            f"**Duration:** {payload.get('lecture_duration', '')} minutes",
            f"**Difficulty:** {payload.get('difficulty', '')}",
            f"**Structure:** {payload.get('lesson_plan_type', '')}",
            f"**Pedagogy:** {payload.get('teaching_approach', '')}",
        ])
        _append_outline_list(lines, "Learning Objectives", payload.get("objectives"), "objective")
        _append_outline_list(lines, "Topics", payload.get("topics_covered"))
        _append_outline_list(lines, "Activity Plan", payload.get("activity_summary"))
        lines.extend(["", "## Assessment", str(payload.get("assessment_summary") or "")])
    elif artifact_type == "lab":
        lines.extend([
            f"**Topic:** {payload.get('topic', '')}",
            f"**Modality:** {payload.get('modality', '')}",
            f"**Duration:** {payload.get('duration_minutes', '')} minutes",
            "",
            str(payload.get("lab_scenario") or ""),
        ])
        _append_outline_list(lines, "Learning Objectives", payload.get("learning_objectives"))
        _append_outline_list(lines, "Student Tasks", payload.get("student_tasks_summary"))
        _append_outline_list(lines, "Deliverables", payload.get("deliverables"))
        lines.extend(["", "## Safety", str(payload.get("safety_summary") or "")])
    else:
        breakdown = payload.get("question_type_breakdown") or {}
        lines.extend([
            f"**Mode:** {payload.get('quiz_mode', '')}",
            f"**Difficulty:** {payload.get('difficulty', '')}",
            f"**Questions:** {payload.get('total_questions', '')}",
            f"**Question breakdown:** {breakdown}",
            f"**Total points:** {payload.get('total_points', '')}",
            f"**Time limit:** {payload.get('time_limit_minutes', '')} minutes",
        ])
        _append_outline_list(lines, "Topics Covered", payload.get("topics_covered"))
    return "\n".join(lines).strip()


def _append_outline_list(
    lines: list[str], title: str, values: Any, value_key: str = ""
) -> None:
    if not isinstance(values, list) or not values:
        return
    lines.extend(["", f"## {title}"])
    for value in values:
        if value_key and isinstance(value, dict):
            text = value.get(value_key)
        else:
            text = value
        lines.append(f"- {text}")


_OUTLINE_CONTEXT_KEYS = (
    "research_summary", "research_summary_json", "lab_research_summary",
    "course_blueprint_outline",
    "active_artifact_type", "active_week", "active_topic", "active_generation_id",
    "active_generation_mode", "active_duration_minutes", "active_lab_modality",
    "last_assessment_lesson_context", "assessment_lesson_doc_status",
    "last_lab_lesson_context", "lab_lesson_doc_status",
)


def outline_context_snapshot(state: dict[str, Any]) -> dict[str, Any]:
    snapshot = {key: state[key] for key in _OUTLINE_CONTEXT_KEYS if key in state}
    # course_blueprint_outline rides in the context snapshot and later overwrites
    # the normalized payload in Phase B's session state — normalize it here so the
    # blueprint workflow receives a dict like every other artifact type, even when
    # the agent stored the outline as a JSON string.
    raw_blueprint = snapshot.get("course_blueprint_outline")
    if raw_blueprint is not None:
        normalized = _state_payload({"course_blueprint_outline": raw_blueprint}, "course_blueprint_outline")
        if isinstance(normalized, dict):
            snapshot["course_blueprint_outline"] = normalized
    return snapshot


def _state_payload(state: dict[str, Any], key: str) -> dict[str, Any] | None:
    raw = state.get(key)
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    elif hasattr(raw, "model_dump"):
        raw = raw.model_dump(mode="json")
    return raw if isinstance(raw, dict) else None


def _coerce_week(value: Any) -> int | None:
    try:
        week = int(value)
    except (TypeError, ValueError):
        return None
    return week if week >= 1 else None


def maybe_save_generated_draft_from_session(
    *,
    batch_id: str,
    lecturer_id: str,
    chat_id: str,
    run_id: str,
    state: dict[str, Any],
    rendered_markdown: str,
    lecturer_email: str,
    workflow_type: str = "",
    requested_week: int | None = None,
) -> dict[str, Any] | None:
    """Save a generated draft using the trusted workflow type for this run."""
    normalized_workflow = workflow_type.strip().lower()
    if not normalized_workflow:
        logger.info(
            "generated draft save skipped run_id=%s reason=empty_workflow_type",
            run_id,
        )
        return None

    candidates = {
        "lesson_plan": (
            "lesson_plan",
            extract_lesson_plan_full_from_state,
            save_lesson_plan_draft_from_session,
            "lesson_plan_payload",
        ),
        "lesson_plan.generate": (
            "lesson_plan",
            extract_lesson_plan_full_from_state,
            save_lesson_plan_draft_from_session,
            "lesson_plan_payload",
        ),
        "lab": ("lab", extract_lab_full_from_state, save_lab_draft_from_session, "lab_payload"),
        "lab.generate": ("lab", extract_lab_full_from_state, save_lab_draft_from_session, "lab_payload"),
        "assessment": (
            "quiz",
            extract_quiz_full_from_state,
            save_quiz_draft_from_session,
            "quiz_payload",
        ),
        "assessment.generate": (
            "quiz",
            extract_quiz_full_from_state,
            save_quiz_draft_from_session,
            "quiz_payload",
        ),
        "quiz": ("quiz", extract_quiz_full_from_state, save_quiz_draft_from_session, "quiz_payload"),
        "quiz.generate": (
            "quiz",
            extract_quiz_full_from_state,
            save_quiz_draft_from_session,
            "quiz_payload",
        ),
    }
    selected = candidates.get(normalized_workflow)
    if not selected:
        logger.info(
            "generated draft save skipped run_id=%s reason=unsupported_workflow_type workflow_type=%s",
            run_id,
            workflow_type,
        )
        return None

    artifact_type, extractor, saver, payload_arg = selected
    payload = extractor(state)
    if not payload:
        logger.info(
            "generated draft save skipped run_id=%s workflow_type=%s artifact_type=%s reason=missing_payload",
            run_id,
            workflow_type,
            artifact_type,
        )
        return None

    expected_week = _coerce_week(requested_week)
    payload_week = _coerce_week(payload.get("week"))
    if expected_week is not None and payload_week != expected_week:
        raise RuntimeError(
            f"{artifact_type} payload week mismatch: requested_week={expected_week}, "
            f"payload_week={payload_week}"
        )

    draft = saver(
        batch_id=batch_id,
        lecturer_id=lecturer_id,
        chat_id=chat_id,
        run_id=run_id,
        rendered_markdown=rendered_markdown,
        lecturer_email=lecturer_email,
        **{payload_arg: payload},
    )
    logger.info(
        "%s draft saved run_id=%s workflow_type=%s artifact_id=%s week=%s",
        artifact_type,
        run_id,
        workflow_type,
        draft.get("id"),
        draft.get("week"),
    )
    return draft


def maybe_store_pending_artifact_from_session(
    *,
    batch_id: str,
    lecturer_id: str,
    chat_id: str,
    run_id: str,
    state: dict[str, Any],
    rendered_markdown: str,
    lecturer_email: str,
    workflow_type: str = "",
    requested_week: int | None = None,
) -> dict[str, Any] | None:
    """Store a run-scoped pending artifact for normal chat export confirmation."""
    del lecturer_id, lecturer_email
    normalized_workflow = workflow_type.strip().lower()
    candidates = {
        "lesson_plan": ("lesson_plan", extract_lesson_plan_full_from_state),
        "lesson_plan.generate": ("lesson_plan", extract_lesson_plan_full_from_state),
        "lab": ("lab", extract_lab_full_from_state),
        "lab.generate": ("lab", extract_lab_full_from_state),
        "assessment": ("quiz", extract_quiz_full_from_state),
        "assessment.generate": ("quiz", extract_quiz_full_from_state),
        "quiz": ("quiz", extract_quiz_full_from_state),
        "quiz.generate": ("quiz", extract_quiz_full_from_state),
        "course_blueprint": ("course_blueprint", extract_course_blueprint_full_from_state),
        "course_blueprint.generate": ("course_blueprint", extract_course_blueprint_full_from_state),
        # Game is run-scoped (the agent stamps staged_in_run), so its extractor needs the
        # run id the other artifact extractors don't take.
        "game": ("game", lambda s: extract_game_full_from_state(s, run_id)),
        "game.generate": ("game", lambda s: extract_game_full_from_state(s, run_id)),
    }
    selected = candidates.get(normalized_workflow)
    if not selected:
        logger.info(
            "pending artifact skipped run_id=%s reason=unsupported_workflow_type workflow_type=%s",
            run_id,
            workflow_type,
        )
        return None

    artifact_type, extractor = selected
    payload = extractor(state)
    if not payload:
        logger.info(
            "pending artifact skipped run_id=%s workflow_type=%s artifact_type=%s reason=missing_payload",
            run_id,
            workflow_type,
            artifact_type,
        )
        return None

    # Course planning is course-level and a game is scoped to the attached PDF; both are
    # weekless. Everything else is week-scoped and must match the requested week.
    payload_week = _coerce_week(payload.get("week"))
    if artifact_type not in {"course_blueprint", "game"}:
        expected_week = _coerce_week(requested_week)
        if expected_week is not None and payload_week != expected_week:
            raise RuntimeError(
                f"{artifact_type} pending artifact week mismatch: requested_week={expected_week}, "
                f"payload_week={payload_week}"
            )
        if expected_week is None and payload_week is None:
            raise RuntimeError(f"{artifact_type} pending artifact payload.week is required")

    preview_markdown, preview_renderer_version = render_preview_markdown(
        artifact_type,
        payload,
        rendered_markdown,
    )
    pending = {
        "pending_artifact_id": f"pending_{run_id}",
        "artifact_type": artifact_type,
        "workflow_type": artifact_type,
        "week": payload_week,
        "title": str(payload.get("title") or {"lesson_plan": "Lesson Plan", "lab": "Lab", "quiz": "Assessment", "course_blueprint": "Course Plan", "game": "Study Game"}[artifact_type]),
        "content_json": payload,
        "content_hash": content_hash(payload),
        "preview_markdown": preview_markdown,
        "preview_renderer_version": preview_renderer_version,
        "content_schema_version": "v2",
        "source_run_id": run_id,
        "source_chat_id": chat_id,
        "batch_id": batch_id,
        "status": "pending_export",
    }
    mark_agent_run_pending_artifact(
        batch_id=batch_id,
        chat_id=chat_id,
        run_id=run_id,
        pending_artifact=pending,
    )
    logger.info(
        "pending artifact stored run_id=%s type=%s week=%s hash=%s",
        run_id,
        artifact_type,
        payload_week,
        pending["content_hash"],
    )
    return pending


def _draft_message_metadata(draft: dict[str, Any] | None) -> dict[str, Any]:
    if not draft:
        return {}
    artifact_type = str(draft.get("artifact_type") or draft.get("type") or "")
    return {
        "draft_artifact_id": str(draft.get("id") or draft.get("artifact_id") or ""),
        "artifact_type": artifact_type,
        "artifact_title": str(draft.get("title") or ""),
        "artifact_preview_card": artifact_type in {"lesson_plan", "lab", "quiz"},
        "week": draft.get("week"),
        "content_hash": draft.get("content_hash"),
        "preview_renderer_version": draft.get("preview_renderer_version"),
        "exportable": True,
    }


def _pending_artifact_message_metadata(pending: dict[str, Any] | None) -> dict[str, Any]:
    if not pending:
        return {}
    artifact_type = str(pending.get("artifact_type") or "")
    is_blueprint = artifact_type == "course_blueprint"
    is_game = artifact_type == "game"
    export_target = (
        "course_blueprint" if is_blueprint
        else "game" if is_game
        else "google_forms" if artifact_type == "quiz"
        else "google_docs"
    )
    metadata = {
        "pending_artifact_id": str(pending.get("pending_artifact_id") or ""),
        "pending_artifact_type": artifact_type,
        "pending_artifact_week": pending.get("week"),
        "pending_artifact_content_hash": str(pending.get("content_hash") or ""),
        # Blueprint and game terminals are backend Firestore writes ("save a course-plan
        # version" / "create the game"), not Google Docs/Forms exports.
        "pending_exportable": not (is_blueprint or is_game),
        "pending_savable_blueprint": is_blueprint,
        "pending_savable_game": is_game,
        "pending_export_target": export_target,
        "artifact_type": artifact_type,
        "artifact_title": str(pending.get("title") or ""),
        "artifact_preview_card": True,
        "week": pending.get("week"),
    }
    if is_game:
        content = pending.get("content_json") if isinstance(pending.get("content_json"), dict) else {}
        metadata["game_item_count"] = len(content.get("items") or [])
    return metadata


def render_email_preview_markdown(
    recipients: list[str], subject: str, body: str
) -> str:
    count = len(recipients)
    if count <= 5:
        who = ", ".join(recipients)
    else:
        who = ", ".join(recipients[:5]) + f", +{count - 5} more"
    return "\n".join(
        [
            "**📧 Email ready to send**",
            "",
            f"**To ({count}):** {who}",
            f"**Subject:** {subject}",
            "",
            body,
        ]
    )


def maybe_store_pending_email_from_session(
    *,
    batch_id: str,
    chat_id: str,
    run_id: str,
    state: dict[str, Any],
) -> dict[str, Any] | None:
    """Store a run-scoped pending email when the agent staged one this run.

    Mirrors ``maybe_store_pending_artifact_from_session`` so email reuses the same
    claim/hash/mark export lifecycle, but the terminal action is a Gmail send/schedule
    (owned by the backend) rather than a Google Docs/Forms export.
    """
    payload = extract_email_full_from_state(state, run_id)
    if not payload:
        return None

    content = {
        "recipients": payload["recipients"],
        "subject": payload["subject"],
        "body": payload["body"],
    }
    pending = {
        "pending_artifact_id": f"pending_{run_id}",
        "artifact_type": "email",
        "workflow_type": "email",
        "week": None,
        "title": payload["subject"],
        "content_json": content,
        "content_hash": content_hash(content),
        "preview_markdown": render_email_preview_markdown(
            payload["recipients"], payload["subject"], payload["body"]
        ),
        "preview_renderer_version": "email_v1",
        "content_schema_version": "v1",
        "source_run_id": run_id,
        "source_chat_id": chat_id,
        "batch_id": batch_id,
        "status": "pending_export",
    }
    mark_agent_run_pending_artifact(
        batch_id=batch_id,
        chat_id=chat_id,
        run_id=run_id,
        pending_artifact=pending,
    )
    logger.info(
        "pending email stored run_id=%s recipients=%d hash=%s",
        run_id,
        len(payload["recipients"]),
        pending["content_hash"],
    )
    return pending


def _pending_email_message_metadata(pending: dict[str, Any] | None) -> dict[str, Any]:
    if not pending:
        return {}
    content = pending.get("content_json") or {}
    recipients = content.get("recipients") or []
    return {
        "pending_artifact_id": str(pending.get("pending_artifact_id") or ""),
        "pending_artifact_type": "email",
        "pending_artifact_content_hash": str(pending.get("content_hash") or ""),
        "pending_email_sendable": True,
        "pending_export_target": "gmail",
        "artifact_type": "email",
        "artifact_title": str(pending.get("title") or ""),
        "email_subject": str(content.get("subject") or ""),
        # Carried so the UI can prefill an edit form without re-parsing the preview.
        "email_body": str(content.get("body") or ""),
        "email_recipients": list(recipients),
        "email_recipient_count": len(recipients),
        # Reuse the presenter-intro preservation path used by artifact preview cards.
        "artifact_preview_card": True,
    }


def _attach_assistant_intro(
    metadata: dict[str, Any],
    presenter_text: str,
    preview_markdown: str,
) -> None:
    """Keep presenter prose when the message body is replaced by a preview."""
    intro = str(presenter_text or "").strip()
    preview = str(preview_markdown or "").strip()
    if intro and preview and intro != preview:
        metadata["assistant_intro"] = intro

_GOOGLE_GROUNDING_REDIRECT_HOSTS: frozenset[str] = frozenset({
    "vertexaisearch.cloud.google.com",
    "vertexaisearch.googleapis.com",
})

_CLEAN_MD_HEADING_RE = re.compile(r"^#{1,6}\s*", re.MULTILINE)
_CLEAN_MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*|__(.+?)__", re.DOTALL)
_CLEAN_MD_ITALIC_RE = re.compile(r"\*(.+?)\*|_(.+?)_", re.DOTALL)
_CLEAN_MD_BULLET_RE = re.compile(r"^\s*[-*+]\s+", re.MULTILINE)
_CLEAN_MD_WEB_LABEL_RE = re.compile(r"\[web\]\s*", re.IGNORECASE)


def _clean_support_text(text: str, max_chars: int = 300) -> str:
    """Strip markdown decoration from support snippets before storing in message metadata."""
    if not text:
        return ""
    cleaned = str(text)
    cleaned = _CLEAN_MD_HEADING_RE.sub("", cleaned)
    cleaned = _CLEAN_MD_BOLD_RE.sub(lambda m: m.group(1) or m.group(2), cleaned)
    cleaned = _CLEAN_MD_ITALIC_RE.sub(lambda m: m.group(1) or m.group(2), cleaned)
    cleaned = _CLEAN_MD_BULLET_RE.sub("", cleaned)
    cleaned = _CLEAN_MD_WEB_LABEL_RE.sub("", cleaned)
    cleaned = " ".join(cleaned.split())
    return cleaned[:max_chars]


def _is_google_grounding_redirect(hostname: str) -> bool:
    return hostname.lower() in _GOOGLE_GROUNDING_REDIRECT_HOSTS


def _safe_web_url(value: Any) -> str:
    raw = str(value or "").strip()[:500]
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return ""
    if parsed.username or parsed.password:
        return ""
    try:
        port = parsed.port
    except ValueError:
        return ""
    host = parsed.hostname.lower()
    netloc = host
    if port and not (
        (parsed.scheme.lower() == "http" and port == 80)
        or (parsed.scheme.lower() == "https" and port == 443)
    ):
        netloc = f"{host}:{port}"
    return urlunsplit((parsed.scheme.lower(), netloc, parsed.path, parsed.query, ""))[:500]


def _web_search_message_metadata(
    state: dict[str, Any],
    *,
    visible_text: str,
    message_metadata: dict[str, Any],
) -> dict[str, Any]:
    raw = state.get("last_web_search")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return {}
    if not isinstance(raw, dict) or raw.get("status") != "success":
        return {}

    sources: list[dict[str, Any]] = []
    source_by_original_index: dict[int, dict[str, Any]] = {}
    seen_urls: set[str] = set()
    seen_indices: set[int] = set()
    for item in (raw.get("sources") or [])[:40]:
        if not isinstance(item, dict):
            continue
        url = _safe_web_url(item.get("url"))
        if not url or url in seen_urls:
            continue
        try:
            original_index = int(item.get("index") or len(sources) + 1)
        except (TypeError, ValueError):
            original_index = len(sources) + 1
        if original_index < 1 or original_index in seen_indices:
            original_index = next(
                index for index in range(1, 1000) if index not in seen_indices
            )
        seen_urls.add(url)
        seen_indices.add(original_index)

        # Determine the user-facing domain label.
        # If the clickable URL is a Google grounding redirect, the raw hostname is
        # a Google infrastructure domain — never expose that to the user.
        raw_host = (urlsplit(url).hostname or "").lower()[:180]
        is_redirect = _is_google_grounding_redirect(raw_host)

        # Prefer display_domain from PNAI-structured output.
        item_display_domain = str(item.get("display_domain") or "").strip()[:180]
        if is_redirect:
            if item_display_domain and not _is_google_grounding_redirect(item_display_domain):
                display_domain = item_display_domain
            else:
                # Fall back to title if it looks like a bare domain
                candidate_title = str(item.get("title") or "").strip()
                if candidate_title and re.match(
                    r"^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$",
                    candidate_title,
                    re.IGNORECASE,
                ):
                    display_domain = candidate_title.lower()[:180]
                else:
                    display_domain = ""
        else:
            display_domain = item_display_domain or raw_host

        source = {
            "index": original_index,
            "title": str(item.get("title") or item.get("domain") or url)[:180],
            "url": url,
            "domain": display_domain or raw_host,
            "display_domain": display_domain,
            "link_type": "google_grounding_redirect" if is_redirect else "direct",
            "supports": _clean_support_text(str(item.get("supports") or ""), 300),
        }
        sources.append(source)
        source_by_original_index[original_index] = source
        if len(sources) >= 20:
            break
    if not sources:
        return {}

    citations: list[dict[str, Any]] = []
    for item in (raw.get("citations") or [])[:80]:
        if not isinstance(item, dict):
            continue
        try:
            original_source_index = int(item.get("source_index"))
        except (TypeError, ValueError):
            continue
        source = source_by_original_index.get(original_source_index)
        if not source:
            continue
        citations.append({
            "index": len(citations) + 1,
            "source_index": source["index"],
            "title": source["title"],
            "url": source["url"],
            "domain": source["domain"],
            "cited_text": _clean_support_text(str(item.get("cited_text") or ""), 300),
        })
        if len(citations) >= 40:
            break

    # Card messages (outline approval, artifact preview, export) used to DROP all
    # web citations unless a [n] marker literally appeared in the machine-rendered
    # markdown — which it rarely did, so the HITL decision points showed no sources
    # at all despite web search having run. Citations now always attach when web
    # search produced sources; the frontend renders them as chips/side panel.

    queries = [
        str(value)[:300]
        for value in (raw.get("queries") or [])
        if str(value).strip()
    ][:8]
    mode = str(raw.get("extraction_mode") or "none")
    if mode not in {"grounding_metadata", "model_text_fallback", "none"}:
        mode = "none"
    result = {
        "web_search_used": True,
        "web_search_extraction_mode": mode,
        "web_queries": queries,
        "web_source_count": len(sources),
        "web_citation_count": len(citations),
        "web_sources": sources,
        "web_citations": citations,
    }
    if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > 100_000:
        logger.warning("Rejected oversized web citation metadata")
        return {}
    return result


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
    session_assume_exists: bool = False,
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
    session_state_after_cache: dict[str, Any] | None = None

    async def load_session_state_after() -> dict[str, Any]:
        nonlocal session_state_after_cache
        if session_state_after_cache is not None:
            return session_state_after_cache
        resource_name = get_agent_engine_resource_name()
        if not resource_name:
            session_state_after_cache = {}
            return session_state_after_cache
        session_state_after_cache = await get_agent_session_state(
            resource_name=resource_name,
            user_id=lecturer_id,
            session_id=agent_session_id,
        )
        return session_state_after_cache

    def emit_backend_event(
        event_type: str,
        *,
        status: str,
        title: str,
        kind: str = "process",
        detail: dict[str, Any] | None = None,
    ) -> None:
        write_run_event(
            run_id,
            event_type=event_type,
            kind=kind,
            status=status,
            title=title,
            phase=event_type.rsplit(".", 1)[0],
            detail=detail,
            session_id=agent_session_id,
            batch_id=batch_id,
            chat_id=chat_id,
        )

    # Stop is a real interrupt, not just a discard: the agent response is an
    # async stream, so breaking out of this loop closes the generator and drops
    # the upstream connection, which stops generation rather than letting it run
    # to completion. The flag is polled on a timer instead of per chunk — a
    # Firestore read per token would cost more than the tokens saved — and off
    # the event loop so the read never stalls streaming.
    cancel_poll_deadline = time.monotonic() + CANCEL_POLL_SECONDS
    cancelled_mid_stream = False

    try:
        # aclosing() so breaking out of the loop deterministically finalises the
        # generator and tears the upstream connection down there and then,
        # rather than leaving it to garbage collection.
        async with aclosing(
            stream_agent_response(
                user_message=user_message,
                session_id=agent_session_id,
                lecturer_id=lecturer_id,
                session_state=session_state,
                session_assume_exists=session_assume_exists,
            )
        ) as agent_stream:
            # Ripping the stream out from under the SDK can surface as an error
            # from aclose()/the iterator. When the lecturer asked for the stop,
            # that is expected teardown noise, not a failed run.
            async for chunk in agent_stream:
                if time.monotonic() >= cancel_poll_deadline:
                    cancel_poll_deadline = time.monotonic() + CANCEL_POLL_SECONDS
                    if await asyncio.to_thread(
                        is_agent_run_cancelled, batch_id=batch_id, chat_id=chat_id, run_id=run_id
                    ):
                        cancelled_mid_stream = True
                        break
                if not chunk:
                    continue
                final_text_parts.append(chunk)
                write_stream_delta(
                    run_id,
                    chunk_index,
                    chunk,
                    source="agent_engine",
                    mode="native",
                    upstream_event_kind="final_text",
                )
                chunk_index += 1
                streamed_length += len(chunk)
                write_stream_meta(
                    run_id,
                    done=False,
                    chunk_count=chunk_index,
                    final_length=streamed_length,
                    response_started=True,
                )

        if cancelled_mid_stream:
            logger.info(
                "run_id=%s cancelled mid-stream after %d chunks — closing the stream",
                run_id,
                chunk_index,
            )
            emit_backend_event(
                "run.cancelled",
                status="cancelled",
                title="Request cancelled",
                kind="message",
                detail={"chunks_streamed": chunk_index},
            )
            finalize_open_run_steps(run_id, "cancelled")
            set_run_status(run_id, "cancelled")
            return

        # Stop can also land where the mid-stream poll never fired — the stream
        # ended (or yielded nothing) first. Check before the empty-text guard
        # below, or a stop with no output raises and is reported as a failure.
        if is_agent_run_cancelled(batch_id=batch_id, chat_id=chat_id, run_id=run_id):
            logger.info("run_id=%s cancelled by the lecturer — discarding the answer", run_id)
            emit_backend_event(
                "run.cancelled",
                status="cancelled",
                title="Request cancelled",
                kind="message",
            )
            finalize_open_run_steps(run_id, "cancelled")
            set_run_status(run_id, "cancelled")
            return

        final_text = "".join(final_text_parts)
        write_stream_meta(
            run_id,
            done=True,
            chunk_count=chunk_index,
            final_length=len(final_text),
            response_started=bool(final_text.strip()),
        )
        if not final_text.strip():
            raise RuntimeError("Agent Engine stream completed without any assistant text")

        metadata: dict[str, Any] = {}
        assistant_message_text = final_text
        try:
            draft = None
            if str(session_state.get("workflow_stage") or "") == "outline":
                emit_backend_event(
                    "outline_extract.started", status="started", title="Reading generated outline"
                )
                session_state_after = await load_session_state_after()
                outline = extract_outline_from_state(
                    session_state_after, str(session_state.get("workflow_type") or "")
                )
                if outline:
                    artifact_type, outline_payload = outline
                    expected_week = _coerce_week(session_state.get("requested_week"))
                    actual_week = _coerce_week(outline_payload.get("week"))
                    if expected_week is not None and actual_week != expected_week:
                        raise RuntimeError("Generated outline week does not match requested week")
                    mark_agent_run_outline_ready(
                        batch_id=batch_id,
                        chat_id=chat_id,
                        run_id=run_id,
                        artifact_type=artifact_type,
                        outline_payload=outline_payload,
                        outline_context=outline_context_snapshot(session_state_after),
                    )
                    outline_markdown = render_outline_markdown(artifact_type, outline_payload)
                    assistant_message_text = outline_markdown
                    metadata = {
                        "workflow_stage": "outline",
                        "workflow_type": str(session_state.get("workflow_type") or ""),
                        "outline_approvable": True,
                        "outline_artifact_type": artifact_type,
                        "artifact_type": artifact_type,
                        "outline_title": str(outline_payload.get("title") or ""),
                        "artifact_title": str(outline_payload.get("title") or ""),
                        "week": actual_week,
                        "source_run_id": run_id,
                        "approval_action": "approve_outline",
                        "pending_exportable": False,
                        "exportable": False,
                    }
                    _attach_assistant_intro(metadata, final_text, outline_markdown)
                    emit_backend_event(
                        "outline_extract.done", status="done", title="Outline ready for review"
                    )
                    emit_backend_event(
                        "outline_approval.waiting",
                        status="waiting",
                        title="Waiting for lecturer approval",
                    )
                else:
                    emit_backend_event(
                        "outline_extract.failed",
                        status="failed",
                        title="No outline available yet",
                        kind="error",
                        detail={"reason": "clarification_or_generation_incomplete"},
                    )
            elif bool(session_state.get("save_draft")):
                emit_backend_event(
                    "draft_save.started", status="started", title="Saving generated draft"
                )
                session_state_after = await load_session_state_after()
                draft = maybe_save_generated_draft_from_session(
                    batch_id=batch_id,
                    lecturer_id=lecturer_id,
                    chat_id=chat_id,
                    run_id=run_id,
                    state=session_state_after,
                    rendered_markdown=final_text,
                    lecturer_email=str(
                        session_state_after.get("lecturer_email")
                        or session_state.get("lecturer_email")
                        or ""
                    ),
                    workflow_type=str(session_state.get("workflow_type") or ""),
                    requested_week=_coerce_week(session_state.get("requested_week")),
                )
                emit_backend_event(
                    "draft_save.done" if draft else "draft_save.failed",
                    status="done" if draft else "failed",
                    title="Generated draft saved" if draft else "Generated draft was not saved",
                    kind="process" if draft else "error",
                    detail={"saved": bool(draft)},
                )
            elif bool(session_state.get("pending_artifact")):
                emit_backend_event(
                    "pending_artifact.started",
                    status="started",
                    title="Preparing artifact preview",
                )
                session_state_after = await load_session_state_after()
                pending = maybe_store_pending_artifact_from_session(
                    batch_id=batch_id,
                    lecturer_id=lecturer_id,
                    chat_id=chat_id,
                    run_id=run_id,
                    state=session_state_after,
                    rendered_markdown=final_text,
                    lecturer_email=str(
                        session_state_after.get("lecturer_email")
                        or session_state.get("lecturer_email")
                        or ""
                    ),
                    workflow_type=str(session_state.get("workflow_type") or ""),
                    requested_week=_coerce_week(session_state.get("requested_week")),
                )
                emit_backend_event(
                    "pending_artifact.done" if pending else "pending_artifact.failed",
                    status="done" if pending else "failed",
                    title="Artifact preview ready" if pending else "Artifact preview was not created",
                    kind="process" if pending else "error",
                    detail={"created": bool(pending)},
                )
                if pending:
                    metadata = _pending_artifact_message_metadata(pending)
                    approved_outline_run_id = str(
                        session_state.get("approved_outline_run_id") or ""
                    )
                    if approved_outline_run_id:
                        metadata.update(
                            {
                                "workflow_stage": "full",
                                "approved_outline_run_id": approved_outline_run_id,
                            }
                        )
                    preview_markdown = str(pending.get("preview_markdown") or "").strip()
                    if preview_markdown:
                        _attach_assistant_intro(metadata, final_text, preview_markdown)
                        assistant_message_text = preview_markdown
            else:
                # Plain chat: the email agent may have staged an email this run.
                # session_state_after is already loaded below for web citations /
                # blueprint hints, so this detection adds no extra Agent Engine read.
                session_state_after = await load_session_state_after()
                pending_email = maybe_store_pending_email_from_session(
                    batch_id=batch_id,
                    chat_id=chat_id,
                    run_id=run_id,
                    state=session_state_after,
                )
                if pending_email:
                    emit_backend_event(
                        "pending_email.done",
                        status="done",
                        title="Email ready to send",
                    )
                    metadata = _pending_email_message_metadata(pending_email)
                    preview_markdown = str(pending_email.get("preview_markdown") or "").strip()
                    if preview_markdown:
                        _attach_assistant_intro(metadata, final_text, preview_markdown)
                        assistant_message_text = preview_markdown
                else:
                    logger.info("generated draft save skipped run_id=%s reason=save_draft_false", run_id)
            if draft:
                metadata = _draft_message_metadata(draft)
                preview_markdown = str(draft.get("preview_markdown") or "").strip()
                if preview_markdown:
                    _attach_assistant_intro(metadata, final_text, preview_markdown)
                    assistant_message_text = preview_markdown
                mark_agent_run_draft_saved(
                    batch_id=batch_id,
                    chat_id=chat_id,
                    run_id=run_id,
                    artifact_id=str(metadata.get("draft_artifact_id") or ""),
                    week=draft.get("week"),
                )
                logger.info(
                    "generated draft saved run_id=%s artifact_id=%s type=%s week=%s",
                    run_id,
                    metadata.get("draft_artifact_id"),
                    metadata.get("artifact_type"),
                    metadata.get("week"),
                )
        except Exception as draft_exc:
            operation = (
                "draft_save" if bool(session_state.get("save_draft")) else "pending_artifact"
            )
            emit_backend_event(
                f"{operation}.failed",
                status="failed",
                title="Artifact persistence failed",
                kind="error",
                detail={"error": str(draft_exc)[:500]},
            )
            logger.warning(
                "Generated content returned, but draft artifact save failed run_id=%s: %s",
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

        # Card-producing workflows replace the persisted message body with
        # deterministic preview Markdown. Preserve the streamed root presenter
        # response once, here, so outline/full and future preview-card workflows
        # cannot diverge by artifact type.
        if metadata.get("artifact_preview_card") or metadata.get("workflow_stage") == "outline":
            _attach_assistant_intro(metadata, final_text, assistant_message_text)

        try:
            session_state_after = await load_session_state_after()
            metadata.update(
                _web_search_message_metadata(
                    session_state_after,
                    visible_text=assistant_message_text,
                    message_metadata=metadata,
                )
            )
        except Exception as citation_exc:
            logger.warning(
                "Web citation metadata read failed run_id=%s: %s",
                run_id,
                citation_exc,
            )

        # Persist assistant message to Firestore
        try:
            final_msg = add_message(
                batch_id,
                chat_id,
                "assistant",
                assistant_message_text,
                lecturer_id,
                run_id=run_id,
                metadata=metadata,
            )
            write_final_message(
                run_id,
                assistant_message_text,
                metadata=metadata,
                message_id=str(final_msg.get("message_id") or ""),
            )
            emit_backend_event(
                "final_message.persisted",
                status="done",
                title="Final message persisted",
                kind="message",
            )
        except Exception as message_exc:
            emit_backend_event(
                "final_message.failed",
                status="failed",
                title="Final message persistence failed",
                kind="error",
                detail={"error": str(message_exc)[:500]},
            )
            raise

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
        finalize_open_run_steps(run_id, "done")
        set_run_status(run_id, "done")
        try:
            persist_agent_run_timeline(
                batch_id=batch_id,
                chat_id=chat_id,
                run_id=run_id,
                timeline_snapshot=read_run_timeline_snapshot(run_id),
            )
        except Exception as timeline_exc:
            logger.warning("Timeline persistence failed run_id=%s: %s", run_id, timeline_exc)
        logger.info("gateway background done run_id=%s chars=%d", run_id, len(final_text))

    except Exception as exc:
        # A stop the lecturer asked for must never surface as a failure. Tearing
        # the Agent Engine stream down mid-flight can raise from the SDK, and
        # the post-stream path has its own guards (e.g. "no assistant text")
        # that a cancellation trivially trips. Settle as cancelled instead.
        if cancelled_mid_stream:
            logger.info("run_id=%s cancelled; ignoring teardown error: %s", run_id, exc)
            try:
                emit_backend_event(
                    "run.cancelled",
                    status="cancelled",
                    title="Request cancelled",
                    kind="message",
                    detail={"chunks_streamed": chunk_index},
                )
                finalize_open_run_steps(run_id, "cancelled")
                set_run_status(run_id, "cancelled")
            except Exception as cancel_exc:
                logger.warning("Cancel finalisation failed run_id=%s: %s", run_id, cancel_exc)
            return
        logger.error("gateway background failed run_id=%s: %s", run_id, exc)
        try:
            write_stream_meta(
                run_id,
                done=True,
                chunk_count=chunk_index,
                final_length=len("".join(final_text_parts)),
                response_started=chunk_index > 0,
            )
        except Exception as stream_exc:
            logger.warning("RTDB stream meta failure failed run_id=%s: %s", run_id, stream_exc)
        safe_error = safe_run_error_message(exc)
        emit_backend_event(
            "run.failed",
            status="failed",
            title="Agent run failed",
            kind="error",
            detail={"error": safe_error},
        )
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
        failure_msg: dict[str, Any] = {}
        try:
            failure_msg = add_message(
                batch_id, chat_id, "assistant", final_error, lecturer_id, run_id=run_id,
            )
        except Exception as message_exc:
            logger.warning("Firestore failure message write failed run_id=%s: %s", run_id, message_exc)
        write_run_error(run_id, safe_error)
        write_final_message(
            run_id, final_error, message_id=str(failure_msg.get("message_id") or "")
        )
        finalize_open_run_steps(run_id, "failed")
        set_run_status(run_id, "failed")
        try:
            persist_agent_run_timeline(
                batch_id=batch_id,
                chat_id=chat_id,
                run_id=run_id,
                timeline_snapshot=read_run_timeline_snapshot(run_id),
            )
        except Exception as timeline_exc:
            logger.warning("Failed-run timeline persistence failed run_id=%s: %s", run_id, timeline_exc)
