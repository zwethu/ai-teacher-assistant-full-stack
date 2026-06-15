"""Agent Engine gateway — run lifecycle and event stream management.

Backend responsibility:
  1. Generate run_id, write agentRuns/{run_id}/meta + status=running.
  2. Set chats/{chat_id}/activeRunId = run_id.
  3. Build session state payload (run_id, session_id, chat_id, rtdb_run_path,
     batch context) and forward to Agent Engine.
  4. Mirror top-level Agent Engine stream events into RTDB (Phase 5).
  5. Persist final assistant message to Firestore.
  6. Set agentRuns/{run_id}/status = done | failed.

Agent responsibility:
  - Emit nested process/tool/retrieval/artifact events directly to
    agentRuns/{run_id}/events/{event_id} and agentRuns/{run_id}/steps/{step_id}.

Frontend responsibility:
  - Listen to agentRuns/{run_id}/events (child_added) for the live feed.
  - Listen to agentRuns/{run_id}/status (value) for run completion.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from utils.firebase_auth import CurrentUser, get_current_user
from utils.rtdb_client import create_run_meta, set_run_status, write_final_message

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AgentInvokeRequest(BaseModel):
    message: str
    chat_id: str
    batch_id: str
    batch_name: str = ""
    course_name: str = ""
    datastore_id: str = ""
    academic_year: str = ""
    term: str = ""
    enable_web_search: bool = True


class AgentInvokeResponse(BaseModel):
    run_id: str
    chat_id: str
    rtdb_run_path: str
    status: str = "running"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/invoke", response_model=AgentInvokeResponse)
async def invoke_agent(
    body: AgentInvokeRequest,
    user: CurrentUser = Depends(get_current_user),
) -> AgentInvokeResponse:
    """Create a run, write RTDB lifecycle nodes, invoke Agent Engine.

    The agent writes nested process/tool events to the same RTDB run path.
    This endpoint returns immediately with run_id so the frontend can start
    listening to the RTDB event stream before the agent finishes.
    """
    run_id = f"run_{uuid.uuid4().hex[:16]}"
    rtdb_run_path = f"agentRuns/{run_id}"
    lecturer_id: str = user.get("uid", "")

    # --- Step 1: write RTDB meta + status=running ---
    create_run_meta(
        run_id=run_id,
        chat_id=body.chat_id,
        batch_id=body.batch_id,
        lecturer_id=lecturer_id,
        message_preview=body.message[:200],
    )

    # --- Step 2: build session state payload for Agent Engine ---
    session_state: dict[str, Any] = {
        "run_id": run_id,
        "session_id": body.chat_id,
        "chat_id": body.chat_id,
        "rtdb_run_path": rtdb_run_path,
        "batch_id": body.batch_id,
        "batch_name": body.batch_name,
        "course_name": body.course_name,
        "lecturer_id": lecturer_id,
        "lecturer_email": user.get("email", ""),
        "datastore_id": body.datastore_id,
        "academic_year": body.academic_year,
        "term": body.term,
        "enable_web_search": body.enable_web_search,
    }

    # --- Step 3: invoke Agent Engine (placeholder — replace with real SDK call) ---
    # TODO: Replace with actual google.cloud.aiplatform Agent Engine SDK call.
    #
    # Example (Phase 5):
    #
    #   from google.cloud import aiplatform
    #   agent = aiplatform.reasoning_engines.ReasoningEngine(AGENT_ENGINE_RESOURCE_NAME)
    #   response_text = ""
    #   async for chunk in agent.async_stream_query(
    #       input=body.message,
    #       session_id=body.chat_id,
    #       state=session_state,
    #   ):
    #       # Mirror top-level stream events to RTDB here (Phase 5)
    #       response_text += chunk.get("text", "")
    #
    #   write_final_message(run_id, response_text)
    #   set_run_status(run_id, "done")

    logger.info(
        "agent.invoke run_id=%s chat_id=%s batch_id=%s lecturer_id=%s",
        run_id,
        body.chat_id,
        body.batch_id,
        lecturer_id,
    )

    # Temporary: mark as done immediately (remove when Agent Engine is wired)
    set_run_status(run_id, "pending_agent_engine")

    return AgentInvokeResponse(
        run_id=run_id,
        chat_id=body.chat_id,
        rtdb_run_path=rtdb_run_path,
        status="running",
    )


@router.get("/runs/{run_id}/status")
async def get_run_status(
    run_id: str,
    _user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    """Return the current RTDB status for a run (polling fallback)."""
    return {"run_id": run_id, "status": "check_rtdb"}
