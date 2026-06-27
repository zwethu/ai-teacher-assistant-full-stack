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

import json
import logging
import uuid
from typing import Any

from fastapi import BackgroundTasks, HTTPException, status

from entity.Batch import BatchModel
from services.agent_engine_client import get_agent_engine_resource_name, stream_agent_response
from services.agent_platform_sessions import get_agent_session_state
from services.agent_artifact_context import build_agent_artifact_manifest
from services.artifact_sync_service import preflight_sync_artifacts_for_agent_run
from services.agent_sessions import (
    create_agent_run_record,
    ensure_chat_agent_session,
    mark_agent_run_done,
    mark_agent_run_draft_failed,
    mark_agent_run_draft_saved,
    mark_agent_run_failed,
    mark_agent_run_pending_artifact,
    mark_agent_run_outline_ready,
)
from services.artifact_service import (
    content_hash,
    render_preview_markdown,
    save_lab_draft_from_session,
    save_lesson_plan_draft_from_session,
    save_quiz_draft_from_session,
)
from services.batch_service import get_batch
from services.chat_service import add_message
from utils.rtdb_client import (
    create_run_meta,
    finalize_open_run_steps,
    set_run_status,
    write_final_message,
    write_run_error,
    write_run_event,
    write_stream_delta,
    write_stream_meta,
)

logger = logging.getLogger(__name__)


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
        workflow_type=workflow_type,
        week=week,
        save_draft=save_draft,
        pending_artifact=pending_artifact,
        workflow_stage=workflow_stage,
        approval_action=approval_action,
        approved_outline_run_id=approved_outline_run_id,
        approved_outline=approved_outline,
        artifact_sync_preflight=artifact_sync_preflight,
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
    workflow_type: str = "",
    week: int | None = None,
    save_draft: bool = False,
    pending_artifact: bool = False,
    workflow_stage: str = "",
    approval_action: str = "",
    approved_outline_run_id: str = "",
    approved_outline: dict[str, Any] | None = None,
    artifact_sync_preflight: dict[str, Any] | None = None,
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
    }
    if approved_outline:
        artifact_type = str(approved_outline.get("outline_artifact_type") or "")
        key = {"lesson_plan": "lesson_plan_outline", "lab": "lab_outline", "quiz": "quiz_outline"}.get(artifact_type)
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


def extract_lesson_plan_full_from_state(state: dict[str, Any]) -> dict[str, Any] | None:
    """Return a plausible LessonPlanFull payload from Agent Platform state."""
    active_type = str(state.get("active_artifact_type") or "").strip()
    if active_type and active_type != "lesson_plan":
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


def extract_outline_from_state(
    state: dict[str, Any], workflow_type: str
) -> tuple[str, dict[str, Any]] | None:
    normalized = workflow_type.strip().lower()
    artifact_type = (
        "lesson_plan" if normalized.startswith("lesson_plan")
        else "lab" if normalized.startswith("lab")
        else "quiz" if normalized.startswith(("assessment", "quiz"))
        else ""
    )
    key = {"lesson_plan": "lesson_plan_outline", "lab": "lab_outline", "quiz": "quiz_outline"}.get(artifact_type)
    payload = _state_payload(state, key) if key else None
    if not payload or not str(payload.get("title") or "").strip():
        return None
    try:
        if int(payload.get("week")) < 1:
            return None
    except (TypeError, ValueError):
        return None
    return artifact_type, payload


def render_outline_markdown(artifact_type: str, payload: dict[str, Any]) -> str:
    title = str(payload.get("title") or "Generated outline")
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
    "active_artifact_type", "active_week", "active_topic", "active_generation_id",
    "active_generation_mode", "active_duration_minutes", "active_lab_modality",
    "last_assessment_lesson_context", "assessment_lesson_doc_status",
    "last_lab_lesson_context", "lab_lesson_doc_status",
)


def outline_context_snapshot(state: dict[str, Any]) -> dict[str, Any]:
    return {key: state[key] for key in _OUTLINE_CONTEXT_KEYS if key in state}


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

    expected_week = _coerce_week(requested_week)
    payload_week = _coerce_week(payload.get("week"))
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
        "title": str(payload.get("title") or {"lesson_plan": "Lesson Plan", "lab": "Lab", "quiz": "Assessment"}[artifact_type]),
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
    return {
        "pending_artifact_id": str(pending.get("pending_artifact_id") or ""),
        "pending_artifact_type": str(pending.get("artifact_type") or ""),
        "pending_artifact_week": pending.get("week"),
        "pending_artifact_content_hash": str(pending.get("content_hash") or ""),
        "pending_exportable": True,
        "pending_export_target": "google_forms" if pending.get("artifact_type") == "quiz" else "google_docs",
        "artifact_type": str(pending.get("artifact_type") or ""),
        "artifact_title": str(pending.get("title") or ""),
        "artifact_preview_card": True,
        "week": pending.get("week"),
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
                session_state_after = await get_agent_session_state(
                    resource_name=get_agent_engine_resource_name(),
                    user_id=lecturer_id,
                    session_id=agent_session_id,
                )
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
                session_state_after = await get_agent_session_state(
                    resource_name=get_agent_engine_resource_name(),
                    user_id=lecturer_id,
                    session_id=agent_session_id,
                )
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
                session_state_after = await get_agent_session_state(
                    resource_name=get_agent_engine_resource_name(),
                    user_id=lecturer_id,
                    session_id=agent_session_id,
                )
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
            write_final_message(run_id, assistant_message_text, metadata=metadata)
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
        logger.info("gateway background done run_id=%s chars=%d", run_id, len(final_text))

    except Exception as exc:
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
        try:
            add_message(
                batch_id, chat_id, "assistant", final_error, lecturer_id, run_id=run_id,
            )
        except Exception as message_exc:
            logger.warning("Firestore failure message write failed run_id=%s: %s", run_id, message_exc)
        write_run_error(run_id, safe_error)
        write_final_message(run_id, final_error)
        finalize_open_run_steps(run_id, "failed")
        set_run_status(run_id, "failed")
