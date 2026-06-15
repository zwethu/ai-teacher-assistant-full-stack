"""Chat and message endpoints for batch-scoped conversations."""

import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from services.batch_service import get_batch
from services.chat_service import (
    add_message,
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

_AGENT_ENGINE_URL = os.getenv("AGENT_ENGINE_URL", "").strip()


class CreateChatBody(BaseModel):
    title: str = "New Chat"


class SendMessageBody(BaseModel):
    content: str


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
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """
    Persist the user message, call the Agent Engine (if configured),
    persist the assistant reply, and return both.
    """
    lecturer_id: str = current_user["uid"]

    chat = get_chat(batch_id, chat_id, lecturer_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    batch = get_batch(batch_id, lecturer_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    user_msg = add_message(batch_id, chat_id, "user", body.content, lecturer_id)

    reply_content = await _call_agent(
        user_message=body.content,
        batch=batch,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
        token=current_user.get("token", ""),
    )

    assistant_msg = add_message(batch_id, chat_id, "assistant", reply_content, lecturer_id)

    return {
        "user_message": user_msg,
        "assistant_message": assistant_msg,
    }


async def _call_agent(
    user_message: str,
    batch,
    chat_id: str,
    lecturer_id: str,
    token: str,
) -> str:
    """Call Agent Engine and return the assistant reply text. Falls back to placeholder."""
    if not _AGENT_ENGINE_URL:
        return f"(Agent Engine not configured) You said: {user_message!r}"

    payload = {
        "message": user_message,
        "session_id": chat_id,
        "batch_id": batch.batch_id,
        "batch_name": batch.batch_name,
        "course_name": batch.course_name,
        "lecturer_id": lecturer_id,
        "lecturer_email": batch.lecturer_email,
        "datastore_id": batch.datastore_id,
        "academic_year": batch.academic_year,
        "term": batch.term,
    }
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                _AGENT_ENGINE_URL,
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            return str(
                data.get("text")
                or data.get("content")
                or data.get("response")
                or data.get("output")
                or "(no response from agent)"
            )
    except Exception as exc:
        logger.warning("Agent Engine call failed: %s", exc)
        return f"(Agent temporarily unavailable) You said: {user_message!r}"
