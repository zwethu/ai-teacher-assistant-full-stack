"""Chat and message endpoints for batch-scoped conversations."""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from services.agent_gateway import start_chat_run
from services.batch_service import get_batch
from services.chat_service import (
    create_chat,
    delete_chat,
    get_chat,
    list_chats,
    list_messages,
    update_chat_title,
)
from utils.firebase_auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/batches/{batch_id}/chats", tags=["chats"])


class CreateChatBody(BaseModel):
    title: str = "New Chat"


class ConnectorState(BaseModel):
    web_search: bool = True
    google_workspace: bool = False


class SendMessageBody(BaseModel):
    content: str
    connectors: ConnectorState = Field(default_factory=ConnectorState)


class UpdateTitleBody(BaseModel):
    title: str


# ---------------------------------------------------------------------------
# Chat endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_chat_endpoint(
    batch_id: str,
    body: CreateChatBody,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    lecturer_id: str = current_user["uid"]
    if get_batch(batch_id, lecturer_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    return create_chat(batch_id, lecturer_id, body.title)


@router.get("", response_model=list[dict])
async def list_chats_endpoint(
    batch_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    return list_chats(batch_id, current_user["uid"])


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_endpoint(
    batch_id: str,
    chat_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    ok = delete_chat(batch_id, chat_id, current_user["uid"])
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")


@router.patch("/{chat_id}/title", response_model=dict)
async def update_title_endpoint(
    batch_id: str,
    chat_id: str,
    body: UpdateTitleBody,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    ok = update_chat_title(batch_id, chat_id, current_user["uid"], body.title)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Message endpoints
# ---------------------------------------------------------------------------

@router.get("/{chat_id}/messages", response_model=list[dict])
async def list_messages_endpoint(
    batch_id: str,
    chat_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    lecturer_id: str = current_user["uid"]
    chat = get_chat(batch_id, chat_id, lecturer_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return list_messages(batch_id, chat_id, lecturer_id)


@router.post("/{chat_id}/messages", response_model=dict, status_code=status.HTTP_201_CREATED)
async def send_message_endpoint(
    batch_id: str,
    chat_id: str,
    body: SendMessageBody,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Send a message, create a run, start the agent in the background.

    Returns immediately with run_id so the frontend can subscribe to the RTDB
    event stream before the agent finishes.

    Response:
        user_message   — the persisted user message
        run_id         — unique identifier for this agent execution
        rtdb_run_path  — agentRuns/{run_id}, root of the live event stream
        status         — "running"

    The assistant message is persisted to Firestore asynchronously and also
    written to agentRuns/{run_id}/messages/{id} in RTDB when complete.
    """
    lecturer_id: str = current_user["uid"]

    chat = get_chat(batch_id, chat_id, lecturer_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    return await start_chat_run(
        user_message=body.content,
        batch_id=batch_id,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
        lecturer_email=current_user.get("email", ""),
        connectors=body.connectors.model_dump(),
        background_tasks=background_tasks,
    )
