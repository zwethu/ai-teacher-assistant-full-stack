"""Chat and message endpoints for batch-scoped conversations."""

import logging
import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from services.agent_gateway import start_chat_run
from services.agent_sessions import (
    get_agent_run,
    get_agent_run_with_pending_artifact,
    mark_agent_run_pending_artifact_exported,
)
from services.artifact_service import (
    content_hash,
    export_lab_draft_to_google_docs,
    export_lesson_plan_draft_to_google_docs,
    save_pending_artifact_as_draft,
)
from services.batch_service import get_batch
from services.chat_service import (
    create_chat,
    delete_chat,
    get_chat,
    list_chats,
    list_messages,
    update_assistant_message_metadata_for_run,
    update_chat_title,
)
from services.google_workspace.credentials import (
    GoogleOAuthInvalidError,
    GoogleOAuthRequiredError,
)
from utils.firebase_auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/batches/{batch_id}/chats", tags=["chats"])

GOOGLE_OAUTH_REQUIRED_DETAIL = {
    "code": "GOOGLE_OAUTH_REQUIRED",
    "message": "Connect Google Workspace before exporting.",
    "connect_url": "/auth/google-scopes",
}

_WEEK_RE = re.compile(r"\bweek\s*(\d{1,2})\b", re.IGNORECASE)
_ORDINAL_WEEK_RE = re.compile(
    r"\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+"
    r"(?:week|lecture|class)\b",
    re.IGNORECASE,
)
_GENERATE_RE = re.compile(
    r"\b(generate|create|craft|make|build|produce|prepare|write)\b",
    re.IGNORECASE,
)
_LAB_RE = re.compile(r"\b(lab|labs|practical|practicals|laboratory)\b", re.IGNORECASE)
_LESSON_PLAN_RE = re.compile(r"\blesson\s*plan\b", re.IGNORECASE)
_ASSESSMENT_RE = re.compile(r"\b(quiz|assessment|assessments|test|exam)\b", re.IGNORECASE)
_AMBIGUOUS_GENERATION_RE = re.compile(
    r"\b(lesson\s*plan.*lab|lab.*lesson\s*plan|lesson\s+and\s+lab|materials)\b",
    re.IGNORECASE,
)
_ORDINAL_WEEKS = {
    "first": 1,
    "second": 2,
    "third": 3,
    "fourth": 4,
    "fifth": 5,
    "sixth": 6,
    "seventh": 7,
    "eighth": 8,
    "ninth": 9,
    "tenth": 10,
}


class CreateChatBody(BaseModel):
    title: str = "New Chat"


class ConnectorState(BaseModel):
    web_search: bool = True


class SendMessageBody(BaseModel):
    content: str
    connectors: ConnectorState = Field(default_factory=ConnectorState)


class UpdateTitleBody(BaseModel):
    title: str


def propose_chat_workflow_intent(content: str) -> dict | None:
    """Return a conservative generation proposal; never triggers autosave."""
    text = content.strip()
    if not text or not _GENERATE_RE.search(text):
        return None
    if _AMBIGUOUS_GENERATION_RE.search(text):
        return None

    week_match = _WEEK_RE.search(text)
    ordinal_match = _ORDINAL_WEEK_RE.search(text)
    if week_match:
        week = int(week_match.group(1))
    elif ordinal_match:
        week = _ORDINAL_WEEKS.get(ordinal_match.group(1).lower())
    else:
        return None
    if week is None:
        return None
    artifact_type = ""
    workflow_type = ""
    if _LESSON_PLAN_RE.search(text):
        artifact_type = "lesson_plan"
        workflow_type = "lesson_plan"
    elif _ASSESSMENT_RE.search(text):
        artifact_type = "assessment"
        workflow_type = "assessment"
    elif _LAB_RE.search(text):
        artifact_type = "lab"
        workflow_type = "lab"
    if not workflow_type:
        return None
    return {
        "artifact_type": artifact_type,
        "workflow_type": workflow_type,
        "week": week,
        "confidence": "high",
        "reason": f"User explicitly asked to create {artifact_type} for week {week}",
    }


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


@router.get("/{chat_id}", response_model=dict)
async def get_chat_endpoint(
    batch_id: str,
    chat_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    lecturer_id: str = current_user["uid"]
    chat = get_chat(batch_id, chat_id, lecturer_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return chat


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


@router.get("/{chat_id}/runs/{run_id}", response_model=dict)
async def get_run_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return durable run metadata (status, connectors, RTDB path) for rehydration."""
    lecturer_id: str = current_user["uid"]
    run = get_agent_run(
        batch_id=batch_id,
        chat_id=chat_id,
        run_id=run_id,
        lecturer_id=lecturer_id,
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return run


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

    proposal = propose_chat_workflow_intent(body.content)
    if proposal:
        logger.info(
            "chat workflow proposal detected batch_id=%s chat_id=%s proposal=%s",
            batch_id,
            chat_id,
            proposal,
        )
    use_pending = bool(proposal and proposal.get("workflow_type") in {"lesson_plan", "lab"})

    return await start_chat_run(
        user_message=body.content,
        batch_id=batch_id,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
        lecturer_email=current_user.get("email", ""),
        connectors=body.connectors.model_dump(),
        background_tasks=background_tasks,
        workflow_type=str(proposal.get("workflow_type") or "") if use_pending else "",
        week=int(proposal["week"]) if use_pending else None,
        save_draft=False,
        pending_artifact=use_pending,
    )


@router.post("/{chat_id}/runs/{run_id}/pending-artifact/generate-docs", response_model=dict)
async def generate_docs_from_pending_artifact_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create/export Google Docs from the exact pending artifact JSON for a run."""
    lecturer_id: str = current_user["uid"]
    if get_batch(batch_id, lecturer_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")
    chat = get_chat(batch_id, chat_id, lecturer_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    run = get_agent_run_with_pending_artifact(
        batch_id=batch_id,
        chat_id=chat_id,
        run_id=run_id,
        lecturer_id=lecturer_id,
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    pending = run.get("pending_artifact")
    if not isinstance(pending, dict):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending artifact not found")

    status_value = str(pending.get("status") or "")
    artifact_type = str(pending.get("artifact_type") or "")
    if artifact_type not in {"lesson_plan", "lab"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending artifact type is not supported")
    if status_value not in {"pending_export", "exported"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending artifact is not exportable")

    content = pending.get("content_json")
    if not isinstance(content, dict) or not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending artifact content is missing")
    expected_hash = str(pending.get("content_hash") or "")
    actual_hash = content_hash(content)
    if expected_hash and expected_hash != actual_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending artifact content hash mismatch")

    try:
        artifact_id = str(pending.get("artifact_id") or "")
        if not artifact_id:
            draft = save_pending_artifact_as_draft(
                batch_id=batch_id,
                lecturer_id=lecturer_id,
                pending_artifact=pending,
                lecturer_email=current_user.get("email", ""),
            )
            artifact_id = str(draft.get("id") or draft.get("artifact_id") or "")
        if artifact_type == "lab":
            result = export_lab_draft_to_google_docs(batch_id, artifact_id, lecturer_id)
        else:
            result = export_lesson_plan_draft_to_google_docs(batch_id, artifact_id, lecturer_id)
    except (GoogleOAuthRequiredError, GoogleOAuthInvalidError) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=GOOGLE_OAUTH_REQUIRED_DETAIL,
        ) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("pending artifact export failed run_id=%s", run_id)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    exported_pending = {
        **pending,
        "status": "exported",
        "artifact_id": artifact_id,
        "export_result": result,
    }
    mark_agent_run_pending_artifact_exported(
        batch_id=batch_id,
        chat_id=chat_id,
        run_id=run_id,
        pending_artifact=exported_pending,
    )

    metadata = {
        "draft_artifact_id": artifact_id,
        "artifact_id": artifact_id,
        "artifact_type": artifact_type,
        "week": pending.get("week"),
        "exportable": False,
        "pending_exportable": False,
        "pending_artifact_id": str(pending.get("pending_artifact_id") or ""),
        "pending_artifact_type": artifact_type,
        "pending_artifact_week": pending.get("week"),
        "pending_artifact_content_hash": actual_hash,
        "version": result.get("version"),
        "drive_file_name": result.get("drive_file_name", ""),
        "doc_url": result.get("doc_url", ""),
        "doc_id": result.get("doc_id", ""),
        "lecturer_doc_url": result.get("lecturer_doc_url", ""),
        "lecturer_doc_id": result.get("lecturer_doc_id", ""),
        "lecturer_drive_file_name": result.get("lecturer_drive_file_name", ""),
        "student_doc_url": result.get("student_doc_url", ""),
        "student_doc_id": result.get("student_doc_id", ""),
        "student_drive_file_name": result.get("student_drive_file_name", ""),
    }
    update_assistant_message_metadata_for_run(
        batch_id=batch_id,
        chat_id=chat_id,
        run_id=run_id,
        metadata={key: value for key, value in metadata.items() if value not in ("", None)},
    )

    return {
        **result,
        "artifact_id": artifact_id,
        "pending_artifact_id": str(pending.get("pending_artifact_id") or ""),
        "artifact_type": artifact_type,
    }
