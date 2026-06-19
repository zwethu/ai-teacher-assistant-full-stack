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
from pydantic import BaseModel

from services.agent_gateway import start_chat_run
from services.chat_service import get_chat
from utils.firebase_auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AgentInvokeRequest(BaseModel):
    """Minimal request — batch context is loaded from Firestore, not trusted from client."""
    message: str
    chat_id: str
    batch_id: str
    enable_web_search: bool = True


class AgentInvokeResponse(BaseModel):
    run_id: str
    chat_id: str
    rtdb_run_path: str
    status: str = "running"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

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

    # Verify the chat belongs to this lecturer before creating a run.
    chat = get_chat(body.batch_id, body.chat_id, lecturer_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found or access denied",
        )

    result = await start_chat_run(
        user_message=body.message,
        batch_id=body.batch_id,
        chat_id=body.chat_id,
        lecturer_id=lecturer_id,
        lecturer_email=user.get("email", ""),
        enable_web_search=body.enable_web_search,
        background_tasks=background_tasks,
    )

    return AgentInvokeResponse(
        run_id=result["run_id"],
        chat_id=body.chat_id,
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
