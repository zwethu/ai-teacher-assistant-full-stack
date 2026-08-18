"""Agent gateway router — /agent/invoke and run status endpoints.

POST /agent/invoke is the structured-page entrypoint (lesson plan, assessment,
lab pages) that need explicit run control.  Chat pages use the message endpoint
at POST /batches/{batch_id}/chats/{chat_id}/messages instead, which calls the
same AgentGateway internally.

Both paths share:
  - AgentGateway.start_chat_run() for run lifecycle + RTDB wiring
  - batch context sourced from Firestore (not the request body)
  - BackgroundTasks for async Agent Engine streaming
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from services.agent_gateway import start_chat_run
from services.agent_sessions import (
    claim_approvable_outline_run,
    get_approvable_outline_run,
    invalidate_latest_outline_for_followup,
)
from services.chat_service import (
    get_chat,
    get_or_create_workflow_chat,
    update_assistant_message_metadata_for_run,
)
from services.wellness_service import (
    apply_feature_stress,
    workflow_action,
    workflow_stress_cost,
)
from utils.firebase_auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ConnectorState(BaseModel):
    web_search: bool = True


class AgentInvokeRequest(BaseModel):
    """Minimal request — batch context is loaded from Firestore, not trusted from client."""
    message: str
    batch_id: str
    chat_id: str | None = None
    workflow_type: str | None = None
    week: int | None = None
    save_draft: bool = False
    pending_artifact: bool = False
    workflow_stage: str | None = None
    approval_action: str | None = None
    approved_outline_run_id: str | None = None
    connectors: ConnectorState = Field(default_factory=ConnectorState)
    attachment_ids: list[str] = Field(default_factory=list)


class AgentInvokeResponse(BaseModel):
    run_id: str
    chat_id: str
    rtdb_run_path: str
    status: str = "running"
    user_message: dict


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

_SAVE_DRAFT_WORKFLOWS = {
    "lesson_plan",
    "lesson_plan.generate",
    "lab",
    "lab.generate",
    "assessment",
    "assessment.generate",
    "quiz",
    "quiz.generate",
}
# Course blueprint is a course-level (not per-week) two-stage workflow: it supports the
# outline->approve->full pending-artifact flow but never requires a `week` and never uses
# the one-shot save_draft path (its terminal step is save-blueprint, not doc export).
_COURSE_BLUEPRINT_WORKFLOWS = {"course_blueprint", "course_blueprint.generate"}
# Game is single-shot: no research/outline HITL, no week, and no Google export. It uses the
# pending-artifact path only so the "Create game" button reuses the same claim/hash/export
# lock the other terminals do — its terminal write is a gameSessions doc.
_GAME_WORKFLOWS = {"game", "game.generate"}
_WEEK_REQUIRED_WORKFLOWS = _SAVE_DRAFT_WORKFLOWS
_PENDING_ARTIFACT_WORKFLOWS = (
    _SAVE_DRAFT_WORKFLOWS | _COURSE_BLUEPRINT_WORKFLOWS | _GAME_WORKFLOWS
)


def _validate_invoke_request(body: AgentInvokeRequest) -> None:
    workflow_type = (body.workflow_type or "").strip()
    workflow_stage = body.workflow_stage or ""
    approval_action = body.approval_action or ""
    if workflow_stage not in {"", "outline", "full"}:
        raise HTTPException(status_code=400, detail="workflow_stage must be '', 'outline', or 'full'")
    if approval_action not in {"", "approve_outline", "refine_outline", "refine_full"}:
        raise HTTPException(
            status_code=400,
            detail="approval_action must be '', 'approve_outline', 'refine_outline', or 'refine_full'",
        )
    if approval_action == "refine_outline":
        if workflow_stage != "outline" or not body.approved_outline_run_id:
            raise HTTPException(
                status_code=400,
                detail="refine_outline requires workflow_stage='outline' and approved_outline_run_id",
            )
    if approval_action == "refine_full":
        if (
            workflow_stage != "full"
            or not body.pending_artifact
            or not body.approved_outline_run_id
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "refine_full requires workflow_stage='full', pending_artifact=true, "
                    "and approved_outline_run_id"
                ),
            )
    if workflow_stage == "outline" and body.save_draft:
        raise HTTPException(status_code=400, detail="outline stage cannot save a draft")
    if workflow_stage == "full" and body.pending_artifact:
        if (
            approval_action not in {"approve_outline", "refine_full"}
            or not body.approved_outline_run_id
        ):
            raise HTTPException(
                status_code=400,
                detail="full pending-artifact generation requires an approved outline run",
            )
    if body.save_draft and body.pending_artifact:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="save_draft and pending_artifact cannot both be true",
        )
    if body.save_draft:
        if workflow_type not in _SAVE_DRAFT_WORKFLOWS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="save_draft requires a supported workflow_type",
            )
        if workflow_type in _WEEK_REQUIRED_WORKFLOWS and body.week is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="week is required when save_draft is true",
            )
        if body.week is not None and body.week < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="week must be 1 or greater",
            )
    if body.pending_artifact:
        if body.save_draft:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="pending_artifact requires save_draft=false",
            )
        if workflow_type not in _PENDING_ARTIFACT_WORKFLOWS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="pending_artifact requires a supported artifact workflow_type",
            )
        if body.week is not None and body.week < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="week must be 1 or greater",
            )


@router.post("/invoke", response_model=AgentInvokeResponse)
async def invoke_agent(
    body: AgentInvokeRequest,
    background_tasks: BackgroundTasks,
    user: CurrentUser = Depends(get_current_user),
) -> AgentInvokeResponse:
    """Create a run, write RTDB lifecycle nodes, invoke Agent Engine in background.

    Batch context (batch_name, course_name, datastore_id, academic_year, term) is
    loaded from Firestore and not accepted from the request body.

    Returns run_id and rtdb_run_path immediately so the frontend can subscribe
    to agentRuns/{run_id}/events before the agent finishes.
    """
    lecturer_id: str = user["uid"]
    _validate_invoke_request(body)

    chat_id = body.chat_id
    if chat_id:
        chat = get_chat(body.batch_id, chat_id, lecturer_id)
        if chat is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found or access denied",
            )
    elif body.workflow_type:
        chat = get_or_create_workflow_chat(
            batch_id=body.batch_id,
            lecturer_id=lecturer_id,
            workflow_type=body.workflow_type,
            week=body.week,
            title=f"{body.workflow_type.replace('_', ' ').title()} Workflow",
        )
        chat_id = str(chat["chat_id"])
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="chat_id or workflow_type is required",
        )

    approved_outline: dict | None = None
    approval_action = body.approval_action or ""
    if approval_action == "refine_outline":
        # Revision turn: fetch (don't consume) the outline being refined so the
        # gateway re-seeds it into session state as the CURRENT OUTLINE, then
        # supersede the old approve card — the refine run will produce a NEW
        # approvable outline via the normal outline-ready path.
        approved_outline = get_approvable_outline_run(
            batch_id=body.batch_id,
            chat_id=chat_id,
            run_id=body.approved_outline_run_id,
            lecturer_id=lecturer_id,
        )
        if not approved_outline or not isinstance(
            approved_outline.get("outline_payload"), dict
        ):
            raise HTTPException(status_code=404, detail="Outline to refine not found")
        superseded_run_id = invalidate_latest_outline_for_followup(
            batch_id=body.batch_id, chat_id=chat_id, lecturer_id=lecturer_id
        )
        if superseded_run_id:
            try:
                update_assistant_message_metadata_for_run(
                    batch_id=body.batch_id,
                    chat_id=chat_id,
                    run_id=superseded_run_id,
                    metadata={"outline_approval_status": "superseded"},
                )
            except Exception:
                logger.exception(
                    "Failed to persist superseded outline metadata run_id=%s",
                    superseded_run_id,
                )
    if approval_action == "refine_full":
        # Revision of the already-generated artifact: fetch (don't claim) the
        # outline this chat approved earlier — it was consumed by the approve
        # turn, so its status is "approved" and it is no longer the chat's
        # latest. Nothing is superseded here; the gateway re-seeds it as the
        # APPROVED OUTLINE and the pending-artifact branch stages the revised
        # artifact as a new card.
        requested_family = "quiz" if (body.workflow_type or "").startswith(("assessment", "quiz")) else (body.workflow_type or "").split(".")[0]
        approved_outline = get_approvable_outline_run(
            batch_id=body.batch_id,
            chat_id=chat_id,
            run_id=body.approved_outline_run_id,
            lecturer_id=lecturer_id,
        )
        if not approved_outline or not isinstance(
            approved_outline.get("outline_payload"), dict
        ):
            raise HTTPException(status_code=404, detail="Approved outline to revise not found")
        if str(approved_outline.get("outline_artifact_type") or "") != requested_family:
            raise HTTPException(
                status_code=409, detail="Outline artifact type does not match workflow"
            )
        if str(approved_outline.get("outline_status") or "") != "approved":
            raise HTTPException(
                status_code=409,
                detail="No generated artifact to revise — approve the outline first",
            )
    if (body.workflow_stage or "") == "full" and body.pending_artifact and approval_action == "approve_outline":
        requested_family = "quiz" if (body.workflow_type or "").startswith(("assessment", "quiz")) else (body.workflow_type or "").split(".")[0]
        try:
            approved_outline = claim_approvable_outline_run(
                batch_id=body.batch_id, chat_id=chat_id,
                run_id=body.approved_outline_run_id, lecturer_id=lecturer_id,
                artifact_type=requested_family,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        try:
            update_assistant_message_metadata_for_run(
                batch_id=body.batch_id,
                chat_id=chat_id,
                run_id=body.approved_outline_run_id,
                metadata={"outline_approval_status": "approved"},
            )
        except Exception:
            logger.exception(
                "Failed to persist outline approval message metadata run_id=%s",
                body.approved_outline_run_id,
            )

    result = await start_chat_run(
        user_message=body.message,
        batch_id=body.batch_id,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
        lecturer_email=user.get("email", ""),
        connectors=body.connectors.model_dump(),
        background_tasks=background_tasks,
        workflow_type=body.workflow_type or "",
        week=body.week,
        save_draft=body.save_draft,
        pending_artifact=body.pending_artifact,
        workflow_stage=body.workflow_stage or "",
        approval_action=body.approval_action or "",
        approved_outline_run_id=body.approved_outline_run_id or "",
        approved_outline=approved_outline,
        attachment_ids=body.attachment_ids,
    )

    apply_feature_stress(
        lecturer_id,
        workflow_stress_cost(body.workflow_type),
        workflow_action(body.workflow_type),
    )

    return AgentInvokeResponse(
        run_id=result["run_id"],
        chat_id=chat_id,
        rtdb_run_path=result["rtdb_run_path"],
        status=result["status"],
        user_message=result["user_message"],
    )


@router.get("/runs/{run_id}/status")
async def get_run_status(
    run_id: str,
    _user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    """Polling fallback for run status.

    The primary mechanism is real-time: listen to agentRuns/{run_id}/status
    in Firebase RTDB.  Use this endpoint only if the RTDB listener is unavailable.
    """
    return {
        "run_id": run_id,
        "note": "Use RTDB listener on agentRuns/{run_id}/status for real-time updates.",
    }
