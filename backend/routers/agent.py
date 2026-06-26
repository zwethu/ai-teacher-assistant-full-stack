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
from services.chat_service import get_chat, get_or_create_workflow_chat
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
    connectors: ConnectorState = Field(default_factory=ConnectorState)


class AgentInvokeResponse(BaseModel):
    run_id: str
    chat_id: str
    rtdb_run_path: str
    status: str = "running"


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
_WEEK_REQUIRED_WORKFLOWS = _SAVE_DRAFT_WORKFLOWS
_PENDING_ARTIFACT_WORKFLOWS = {"lesson_plan", "lab"}


def _validate_invoke_request(body: AgentInvokeRequest) -> None:
    workflow_type = (body.workflow_type or "").strip()
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
                detail="pending_artifact supports only lesson_plan or lab workflow_type",
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
    )

    return AgentInvokeResponse(
        run_id=result["run_id"],
        chat_id=chat_id,
        rtdb_run_path=result["rtdb_run_path"],
        status=result["status"],
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
