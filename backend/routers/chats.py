"""Chat and message endpoints for batch-scoped conversations."""

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError

from entity.CourseBlueprint import CourseBlueprintContent
from services.agent_gateway import render_email_preview_markdown, start_chat_run
from services.course_blueprint_service import save_blueprint_from_content
from services.agent_sessions import (
    claim_pending_artifact_export,
    get_agent_run,
    get_agent_run_with_pending_artifact,
    invalidate_latest_outline_for_followup,
    mark_agent_run_cancelled,
    mark_agent_run_pending_artifact,
    mark_agent_run_pending_artifact_export_failed,
    mark_agent_run_pending_artifact_exported,
    persist_agent_run_timeline,
)
from services.artifact_service import (
    content_hash,
    export_lab_draft_to_google_docs,
    export_lesson_plan_draft_to_google_docs,
    export_quiz_draft_to_google_forms,
    save_pending_artifact_as_draft,
)
from services.batch_service import get_batch
from services.email_dispatch import (
    EmailDispatchError,
    save_pending_email_as_draft,
    schedule_pending_email,
    send_pending_email_now,
)
from services.chat_service import (
    DEFAULT_MESSAGE_LIMIT,
    create_chat,
    delete_chat,
    delete_message,
    get_chat,
    get_message,
    list_chats,
    list_messages,
    update_assistant_message_content_for_run,
    update_assistant_message_metadata_for_run,
    update_chat_title,
)
from services.chat_export_service import (
    SUPPORTED_FORMATS,
    build_export,
    render_chat_markdown,
    render_message_markdown,
)
from entity.ChatAttachment import ChatAttachment
from services.chat_attachment_service import (
    AttachmentTooLargeError,
    AttachmentValidationError,
    create_chat_attachment,
    get_attachment_bytes,
    get_chat_attachment,
    delete_attachment_record,
    list_sent_chat_attachments,
)
from services.cloud_tasks import QUEUE_ATTACHMENTS, enqueue
from services.google_workspace.credentials import (
    GoogleOAuthInvalidError,
    GoogleOAuthRequiredError,
    assert_google_oauth_valid,
)
from utils.firebase_auth import CurrentUser, get_current_user
from utils.rtdb_client import (
    finalize_open_run_steps,
    read_run_timeline_snapshot,
    set_run_status,
    write_run_event,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/batches/{batch_id}/chats", tags=["chats"])

GOOGLE_OAUTH_REQUIRED_DETAIL = {
    "code": "GOOGLE_OAUTH_REQUIRED",
    "message": "Connect Google Workspace before exporting.",
    "connect_url": "/auth/google-scopes",
}

class CreateChatBody(BaseModel):
    title: str = "New Chat"
    # Standalone generation surfaces create a hidden "workflow" chat as a run
    # container so it never surfaces in Chat History (see get_or_create_workflow_chat).
    type: str = "chat"
    workflow_type: str = ""
    hidden: bool = False


class SchedulePendingEmailRequest(BaseModel):
    send_at: datetime


class UpdatePendingEmailBody(BaseModel):
    """Lecturer edits to a staged email. Omitting recipients keeps the resolved list."""

    subject: str
    body: str
    recipients: list[str] | None = None


class ConnectorState(BaseModel):
    web_search: bool = True


class SendMessageBody(BaseModel):
    content: str
    connectors: ConnectorState = Field(default_factory=ConnectorState)
    attachment_ids: list[str] = Field(default_factory=list)


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
    return create_chat(
        batch_id,
        lecturer_id,
        body.title,
        chat_type=body.type or "chat",
        workflow_type=body.workflow_type or "",
        hidden=bool(body.hidden),
    )


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

@router.post("/{chat_id}/attachments", response_model=ChatAttachment, status_code=status.HTTP_201_CREATED)
async def upload_chat_attachment_endpoint(
    batch_id: str,
    chat_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    file_title: str = Form(""),
    current_user: CurrentUser = Depends(get_current_user),
) -> ChatAttachment:
    lecturer_id = current_user["uid"]
    if get_chat(batch_id, chat_id, lecturer_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    data = await file.read()
    try:
        # Fast path off the event loop: validate + store + doc(status=processing).
        attachment = await asyncio.to_thread(
            create_chat_attachment,
            batch_id=batch_id, chat_id=chat_id, lecturer_id=lecturer_id,
            file_name=file.filename or "upload", file_title=file_title,
            content_type=file.content_type or "application/octet-stream", data=data,
        )
        if attachment.status == "processing":
            # Durable processing via Cloud Tasks (local: inline via BackgroundTasks).
            # The handler re-fetches bytes from GCS — no in-memory payload crosses
            # the request boundary.
            enqueue(
                QUEUE_ATTACHMENTS, "/tasks/process-attachment",
                {"batch_id": batch_id, "chat_id": chat_id, "attachment_id": attachment.attachment_id},
                background_tasks=background_tasks,
            )
        return attachment
    except AttachmentTooLargeError as exc:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)) from exc
    except AttachmentValidationError as exc:
        detail = str(exc)
        code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE if "MB" in detail or "quota" in detail else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=detail) from exc


@router.get("/{chat_id}/attachments", response_model=list[dict])
async def list_chat_attachments_endpoint(
    batch_id: str, chat_id: str, limit: int = 50,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    if get_chat(batch_id, chat_id, current_user["uid"]) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return list_sent_chat_attachments(batch_id, chat_id, current_user["uid"], limit)


@router.get("/{chat_id}/attachments/{attachment_id}/rag-status", response_model=dict)
async def get_chat_attachment_rag_status_endpoint(
    batch_id: str, chat_id: str, attachment_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    attachment = get_chat_attachment(batch_id, chat_id, attachment_id, current_user["uid"])
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return attachment.model_dump(include={
        "attachment_id", "status", "parse_status", "vision_status", "token_estimate",
        "rag_status", "chunk_status", "embedding_status",
        "semantic_search_ready", "chunk_count", "indexed_chars", "ocr_status",
        "expires_at", "rag_updated_at",
    })


@router.get("/{chat_id}/attachments/{attachment_id}", response_model=ChatAttachment)
async def get_chat_attachment_endpoint(
    batch_id: str, chat_id: str, attachment_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> ChatAttachment:
    attachment = get_chat_attachment(batch_id, chat_id, attachment_id, current_user["uid"])
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return attachment


@router.get("/{chat_id}/attachments/{attachment_id}/content")
async def get_chat_attachment_content_endpoint(
    batch_id: str, chat_id: str, attachment_id: str, thumbnail: bool = False,
    current_user: CurrentUser = Depends(get_current_user),
):
    result = get_attachment_bytes(batch_id, chat_id, attachment_id, current_user["uid"], thumbnail)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment content not found")
    payload, content_type, file_name = result
    return Response(
        content=payload,
        media_type=content_type,
        headers={
            # inline so previews render in place instead of downloading
            "Content-Disposition": f'inline; filename="{file_name}"',
            "Cache-Control": "private, max-age=300",
        },
    )

@router.delete("/{chat_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_attachment_endpoint(
    batch_id: str, chat_id: str, attachment_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    result = delete_attachment_record(batch_id, chat_id, attachment_id, current_user["uid"], require_unsent=True)
    if result == "sent":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Sent attachments cannot be removed.")
    if result == "storage_failed":
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Attachment storage cleanup failed; please retry.")
    if result == "not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

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
    return list_messages(batch_id, chat_id, lecturer_id, limit=DEFAULT_MESSAGE_LIMIT)


def _export_response(payload: bytes, media_type: str, filename: str) -> Response:
    return Response(
        content=payload,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # the browser needs to read the filename off a cross-origin response
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


def _validate_format(fmt: str) -> str:
    if fmt not in SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"format must be one of: {', '.join(SUPPORTED_FORMATS)}",
        )
    return fmt


@router.get("/{chat_id}/export")
async def export_chat_endpoint(
    batch_id: str,
    chat_id: str,
    format: str = "markdown",
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Download the whole conversation as Markdown, PDF or DOCX."""
    fmt = _validate_format(format)
    lecturer_id: str = current_user["uid"]
    chat = get_chat(batch_id, chat_id, lecturer_id)
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    messages = list_messages(batch_id, chat_id, lecturer_id)
    markdown_text = render_chat_markdown(chat, messages)
    title = str(chat.get("title") or "chat")

    try:
        payload, media_type, filename = build_export(markdown_text, title, fmt)
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as a 500
        logger.exception("Chat export failed for %s/%s", batch_id, chat_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not export this chat as {fmt}.",
        ) from exc

    return _export_response(payload, media_type, filename)


@router.get("/{chat_id}/messages/{message_id}/export")
async def export_message_endpoint(
    batch_id: str,
    chat_id: str,
    message_id: str,
    format: str = "markdown",
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Download a single response as Markdown, PDF or DOCX."""
    fmt = _validate_format(format)
    lecturer_id: str = current_user["uid"]
    message = get_message(batch_id, chat_id, lecturer_id, message_id)
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    chat = get_chat(batch_id, chat_id, lecturer_id) or {}
    markdown_text = render_message_markdown(message)
    if not markdown_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This message has no content to export."
        )

    title = f"{chat.get('title') or 'chat'} - response"
    try:
        payload, media_type, filename = build_export(markdown_text, title, fmt)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Message export failed for %s/%s/%s", batch_id, chat_id, message_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not export this response as {fmt}.",
        ) from exc

    return _export_response(payload, media_type, filename)


@router.delete("/{chat_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message_endpoint(
    batch_id: str,
    chat_id: str,
    message_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Remove one message.

    Retry uses this to drop the superseded response before re-running, so the
    chat does not collect abandoned answers.
    """
    lecturer_id: str = current_user["uid"]
    if not delete_message(batch_id, chat_id, lecturer_id, message_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")


@router.post("/{chat_id}/runs/{run_id}/cancel", response_model=dict)
async def cancel_run_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Stop a run at the lecturer's request.

    The agent call runs against Agent Engine and cannot be aborted in flight, so
    this marks the run cancelled and the background worker discards the answer if
    it arrives afterwards. Already-terminal runs return cancelled=False so a late
    Stop cannot erase an answer that already landed.
    """
    lecturer_id: str = current_user["uid"]
    if get_chat(batch_id, chat_id, lecturer_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    cancelled = mark_agent_run_cancelled(batch_id=batch_id, chat_id=chat_id, run_id=run_id)
    if cancelled:
        finalize_open_run_steps(run_id, "cancelled")
        set_run_status(run_id, "cancelled")
    return {"run_id": run_id, "cancelled": cancelled}


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
    if not run.get("timeline_snapshot") and run.get("status") in {"done", "failed"}:
        snapshot = read_run_timeline_snapshot(run_id)
        if snapshot:
            persist_agent_run_timeline(
                batch_id=batch_id, chat_id=chat_id, run_id=run_id,
                timeline_snapshot=snapshot,
            )
            run["timeline_snapshot"] = snapshot
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

    superseded_outline_run_id = invalidate_latest_outline_for_followup(
        batch_id=batch_id,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
    )
    if superseded_outline_run_id:
        try:
            update_assistant_message_metadata_for_run(
                batch_id=batch_id,
                chat_id=chat_id,
                run_id=superseded_outline_run_id,
                metadata={"outline_approval_status": "superseded"},
            )
        except Exception:
            logger.exception(
                "Failed to persist superseded outline message metadata run_id=%s",
                superseded_outline_run_id,
            )

    return await start_chat_run(
        user_message=body.content,
        batch_id=batch_id,
        chat_id=chat_id,
        lecturer_id=lecturer_id,
        lecturer_email=current_user.get("email", ""),
        connectors=body.connectors.model_dump(),
        background_tasks=background_tasks,
        workflow_type="",
        week=None,
        save_draft=False,
        pending_artifact=False,
        attachment_ids=body.attachment_ids,
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
    try:
        claim = claim_pending_artifact_export(
            batch_id=batch_id,
            chat_id=chat_id,
            run_id=run_id,
            lecturer_id=lecturer_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    pending = claim["pending_artifact"]
    export_lock_id = str(claim.get("export_lock_id") or "")
    if claim["state"] == "already_exported":
        result = pending.get("export_result")
        if isinstance(result, dict):
            return result
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending artifact export result is missing")
    if claim["state"] == "in_progress":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pending artifact export already in progress.",
        )

    def mark_export_failed(error: str) -> None:
        mark_agent_run_pending_artifact_export_failed(
            batch_id=batch_id,
            chat_id=chat_id,
            run_id=run_id,
            error=error,
            export_lock_id=export_lock_id,
        )
        write_run_event(
            run_id,
            event_type="export.failed",
            kind="error",
            status="failed",
            title="Google Docs export failed",
            phase="export",
            detail={"error": error[:500]},
            batch_id=batch_id,
            chat_id=chat_id,
        )

    write_run_event(
        run_id,
        event_type="export.started",
        status="started",
        title="Exporting artifact to Google Docs",
        phase="export",
        batch_id=batch_id,
        chat_id=chat_id,
    )

    status_value = str(pending.get("status") or "")
    artifact_type = str(pending.get("artifact_type") or "")
    if artifact_type not in {"lesson_plan", "lab"}:
        mark_export_failed("Pending artifact type is not supported")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending artifact type is not supported")
    if status_value != "exporting":
        mark_export_failed("Pending artifact is not exportable")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending artifact is not exportable")

    content = pending.get("content_json")
    if not isinstance(content, dict) or not content:
        mark_export_failed("Pending artifact content is missing")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending artifact content is missing")
    expected_hash = str(pending.get("content_hash") or "")
    actual_hash = content_hash(content)
    if expected_hash and expected_hash != actual_hash:
        mark_export_failed("Pending artifact content hash mismatch")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending artifact content hash mismatch")

    try:
        assert_google_oauth_valid(lecturer_id, ["documents", "drive.file"])
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
        mark_export_failed(str(exc))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=GOOGLE_OAUTH_REQUIRED_DETAIL,
        ) from exc
    except PermissionError as exc:
        mark_export_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("pending artifact export failed run_id=%s", run_id)
        mark_export_failed(str(exc))
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
    write_run_event(
        run_id,
        event_type="export.done",
        status="done",
        title="Google Docs export completed",
        phase="export",
        detail={"artifact_type": artifact_type, "artifact_id": artifact_id},
        batch_id=batch_id,
        chat_id=chat_id,
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


@router.post("/{chat_id}/runs/{run_id}/pending-artifact/save-blueprint", response_model=dict)
async def save_blueprint_from_pending_artifact_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Persist the run's generated Course Plan (blueprint) as a new version.

    The course-plan workflow's confirm-to-persist terminal — analogous to generate-docs,
    but it saves a blueprint version (no Google export). Content comes from the run's
    validated pending artifact, guarded by a content hash.
    """
    lecturer_id: str = current_user["uid"]
    try:
        claim = claim_pending_artifact_export(
            batch_id=batch_id, chat_id=chat_id, run_id=run_id, lecturer_id=lecturer_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    pending = claim["pending_artifact"]
    export_lock_id = str(claim.get("export_lock_id") or "")
    if claim["state"] == "already_exported":
        result = pending.get("export_result")
        if isinstance(result, dict):
            return result
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Blueprint save result is missing")
    if claim["state"] == "in_progress":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Blueprint save already in progress.")

    def mark_failed(error: str) -> None:
        mark_agent_run_pending_artifact_export_failed(
            batch_id=batch_id, chat_id=chat_id, run_id=run_id,
            error=error, export_lock_id=export_lock_id,
        )

    artifact_type = str(pending.get("artifact_type") or "")
    if artifact_type != "course_blueprint":
        mark_failed("Pending artifact is not a course plan")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending artifact is not a course plan")

    content = pending.get("content_json")
    if not isinstance(content, dict) or not content:
        mark_failed("Pending course plan content is missing")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending course plan content is missing")
    expected_hash = str(pending.get("content_hash") or "")
    if expected_hash and expected_hash != content_hash(content):
        mark_failed("Pending course plan content hash mismatch")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending course plan content hash mismatch")

    try:
        blueprint_content = CourseBlueprintContent(**content)
        saved = save_blueprint_from_content(
            batch_id, lecturer_id, blueprint_content,
            source_chat_id=chat_id, source_run_id=run_id,
        )
    except ValidationError as exc:
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Generated course plan is invalid") from exc
    except Exception as exc:
        logger.exception("blueprint save failed run_id=%s", run_id)
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    result = {"blueprint_id": str(saved.get("blueprint_id") or ""), "version": saved.get("version")}
    mark_agent_run_pending_artifact_exported(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        pending_artifact={**pending, "status": "exported", "export_result": result},
    )
    write_run_event(
        run_id, event_type="blueprint.saved", status="done",
        title="Course plan saved", phase="save_blueprint",
        detail={"blueprint_id": result["blueprint_id"], "version": result["version"]},
        batch_id=batch_id, chat_id=chat_id,
    )
    metadata = {
        "pending_savable_blueprint": False,
        "pending_exportable": False,
        "course_blueprint_saved_id": result["blueprint_id"],
        "artifact_type": "course_blueprint",
        "pending_artifact_id": str(pending.get("pending_artifact_id") or ""),
    }
    update_assistant_message_metadata_for_run(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        metadata={k: v for k, v in metadata.items() if v not in ("", None)},
    )
    return {**result, "artifact_type": "course_blueprint"}


@router.post("/{chat_id}/runs/{run_id}/pending-artifact/export-google-form", response_model=dict)
async def export_pending_quiz_to_google_form_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    lecturer_id = current_user["uid"]
    try:
        claim = claim_pending_artifact_export(
            batch_id=batch_id, chat_id=chat_id, run_id=run_id, lecturer_id=lecturer_id
        )
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    pending = claim["pending_artifact"]
    if claim["state"] == "already_exported":
        return pending.get("export_result") or {}
    if claim["state"] == "in_progress":
        raise HTTPException(status_code=409, detail="Pending artifact export already in progress")
    lock_id = str(claim.get("export_lock_id") or "")

    def fail(error: str) -> None:
        mark_agent_run_pending_artifact_export_failed(
            batch_id=batch_id, chat_id=chat_id, run_id=run_id,
            error=error, export_lock_id=lock_id,
        )
        write_run_event(
            run_id, event_type="export.failed", kind="error", status="failed",
            title="Google Forms export failed", phase="export",
            detail={"error": error[:500]}, batch_id=batch_id, chat_id=chat_id,
        )

    write_run_event(
        run_id, event_type="export.started", status="started",
        title="Exporting assessment to Google Forms", phase="export",
        batch_id=batch_id, chat_id=chat_id,
    )
    content = pending.get("content_json")
    try:
        if pending.get("artifact_type") != "quiz" or pending.get("status") != "exporting":
            raise RuntimeError("Pending artifact is not an exportable quiz")
        if not isinstance(content, dict) or not content:
            raise RuntimeError("Pending artifact content is missing")
        actual_hash = content_hash(content)
        if pending.get("content_hash") and pending.get("content_hash") != actual_hash:
            raise RuntimeError("Pending artifact content hash mismatch")
        assert_google_oauth_valid(lecturer_id, ["forms.body", "drive.file"])
        write_run_event(
            run_id, event_type="export.oauth_checked", status="done",
            title="Google Forms access verified", phase="export",
            batch_id=batch_id, chat_id=chat_id,
        )
        draft = save_pending_artifact_as_draft(
            batch_id=batch_id, lecturer_id=lecturer_id, pending_artifact=pending,
            lecturer_email=current_user.get("email", ""),
        )
        artifact_id = str(draft.get("id") or draft.get("artifact_id") or "")
        write_run_event(
            run_id, event_type="export.google_forms_create.started", status="started",
            title="Creating Google Form", phase="export", batch_id=batch_id, chat_id=chat_id,
        )
        result = export_quiz_draft_to_google_forms(batch_id, artifact_id, lecturer_id)
        write_run_event(
            run_id, event_type="export.google_forms_create.done", status="done",
            title="Google Form created", phase="export", batch_id=batch_id, chat_id=chat_id,
        )
    except (GoogleOAuthRequiredError, GoogleOAuthInvalidError) as exc:
        fail(str(exc))
        raise HTTPException(status_code=403, detail=GOOGLE_OAUTH_REQUIRED_DETAIL) from exc
    except Exception as exc:
        fail(str(exc))
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    exported = {**pending, "status": "exported", "artifact_id": artifact_id, "export_result": result}
    mark_agent_run_pending_artifact_exported(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id, pending_artifact=exported
    )
    write_run_event(
        run_id, event_type="export.artifact_record_update.done", status="done",
        title="Assessment artifact updated", phase="export", batch_id=batch_id, chat_id=chat_id,
    )
    metadata = {
        "draft_artifact_id": artifact_id, "artifact_id": artifact_id,
        "artifact_type": "quiz", "pending_exportable": False,
        "pending_artifact_type": "quiz", "form_url": result.get("form_url", ""),
        "form_id": result.get("form_id", ""), "version": result.get("version"),
        "drive_file_name": result.get("drive_file_name", ""),
    }
    update_assistant_message_metadata_for_run(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        metadata={k: v for k, v in metadata.items() if v not in ("", None)},
    )
    write_run_event(
        run_id, event_type="export.done", status="done", title="Google Forms export completed",
        phase="export", batch_id=batch_id, chat_id=chat_id,
    )
    return {**result, "artifact_id": artifact_id, "artifact_type": "quiz"}


def _claim_pending_email(batch_id: str, chat_id: str, run_id: str, lecturer_id: str):
    """Claim + validate the pending email staged for a run.

    Returns ``(early, pending, content, export_lock_id, mark_failed)``. When ``early``
    is not None the caller must return it immediately (the email was already
    sent/scheduled on a prior request — idempotent replay). Otherwise ``content`` is
    the validated ``{recipients, subject, body}`` dict and ``mark_failed(error)``
    releases the export lock and emits a failure event.
    """
    try:
        claim = claim_pending_artifact_export(
            batch_id=batch_id, chat_id=chat_id, run_id=run_id, lecturer_id=lecturer_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    pending = claim["pending_artifact"]
    export_lock_id = str(claim.get("export_lock_id") or "")
    if claim["state"] == "already_exported":
        result = pending.get("export_result")
        early = result if isinstance(result, dict) else {"success": True}
        return early, pending, None, export_lock_id, None
    if claim["state"] == "in_progress":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email action already in progress.",
        )

    def mark_failed(error: str) -> None:
        mark_agent_run_pending_artifact_export_failed(
            batch_id=batch_id, chat_id=chat_id, run_id=run_id,
            error=error, export_lock_id=export_lock_id,
        )
        write_run_event(
            run_id, event_type="email.failed", kind="error", status="failed",
            title="Email action failed", phase="email",
            detail={"error": error[:500]}, batch_id=batch_id, chat_id=chat_id,
        )

    if str(pending.get("artifact_type") or "") != "email":
        mark_failed("Pending artifact is not an email")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending artifact is not an email")
    if str(pending.get("status") or "") != "exporting":
        mark_failed("Pending email is not sendable")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending email is not sendable")

    content = pending.get("content_json")
    recipients = content.get("recipients") if isinstance(content, dict) else None
    if not isinstance(content, dict) or not recipients:
        mark_failed("Pending email content is missing")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending email content is missing")

    expected_hash = str(pending.get("content_hash") or "")
    actual_hash = content_hash(content)
    if expected_hash and expected_hash != actual_hash:
        mark_failed("Pending email content hash mismatch")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pending email content hash mismatch")

    return None, pending, content, export_lock_id, mark_failed


@router.patch("/{chat_id}/runs/{run_id}/pending-artifact/email", response_model=dict)
async def update_pending_email_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    body: UpdatePendingEmailBody,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Edit the email staged for this run before it is sent.

    Rewrites content_json and its hash together so the unchanged send/schedule
    endpoints validate cleanly. Only a draft that has not been claimed for sending
    can be edited — once claimed (status "exporting") or sent, the run is immutable.
    """
    lecturer_id: str = current_user["uid"]
    # Must be the *_with_pending_artifact reader: get_agent_run projects pending_artifact
    # down to a bool (the run-creation request flag), so the dict never survives.
    run = get_agent_run_with_pending_artifact(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id, lecturer_id=lecturer_id
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    pending = run.get("pending_artifact")
    if not isinstance(pending, dict):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No pending email for this run")
    if str(pending.get("artifact_type") or "") != "email":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Pending artifact is not an email")
    if str(pending.get("status") or "") != "pending_export":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email can no longer be edited — it is already being sent or has been sent.",
        )

    existing_content = pending.get("content_json")
    existing_recipients = (
        existing_content.get("recipients") if isinstance(existing_content, dict) else None
    ) or []
    recipients = [r.strip() for r in (body.recipients or existing_recipients) if r and r.strip()]
    if not recipients:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one recipient is required")

    subject = body.subject.strip()
    text = body.body.strip()
    if not subject or not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subject and body are required")

    content = {"recipients": recipients, "subject": subject, "body": text}
    preview_markdown = render_email_preview_markdown(recipients, subject, text)
    updated = {
        **pending,
        "content_json": content,
        "content_hash": content_hash(content),
        "title": subject,
        "preview_markdown": preview_markdown,
        "edited_by_lecturer": True,
    }
    mark_agent_run_pending_artifact(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id, pending_artifact=updated
    )
    # Keep the rendered card in step with what will actually be sent.
    update_assistant_message_content_for_run(
        batch_id=batch_id,
        chat_id=chat_id,
        run_id=run_id,
        content=preview_markdown,
        metadata={
            "pending_artifact_content_hash": updated["content_hash"],
            "artifact_title": subject,
            "email_subject": subject,
            "email_body": text,
            "email_recipients": recipients,
            "email_recipient_count": len(recipients),
        },
    )
    return {
        "success": True,
        "subject": subject,
        "body": text,
        "recipients": recipients,
        "recipient_count": len(recipients),
        "preview_markdown": preview_markdown,
    }


@router.post("/{chat_id}/runs/{run_id}/pending-artifact/send-email", response_model=dict)
async def send_pending_email_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Send the email staged for this run immediately via Gmail (teacher-confirmed)."""
    lecturer_id: str = current_user["uid"]
    early, pending, content, export_lock_id, mark_failed = _claim_pending_email(
        batch_id, chat_id, run_id, lecturer_id
    )
    if early is not None:
        return early

    recipients = [str(r) for r in content["recipients"]]
    subject = str(content.get("subject") or "")
    body = str(content.get("body") or "")

    write_run_event(
        run_id, event_type="email.started", status="started", title="Sending email",
        phase="email", batch_id=batch_id, chat_id=chat_id,
    )
    try:
        assert_google_oauth_valid(lecturer_id, ["gmail.send"])
        result = send_pending_email_now(
            uid=lecturer_id, recipients=recipients, subject=subject, body=body,
            source_run_id=run_id,
        )
    except (GoogleOAuthRequiredError, GoogleOAuthInvalidError) as exc:
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=GOOGLE_OAUTH_REQUIRED_DETAIL) from exc
    except EmailDispatchError as exc:
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("pending email send failed run_id=%s", run_id)
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to send email") from exc

    export_result = {"action": "sent", **result}
    mark_agent_run_pending_artifact_exported(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        pending_artifact={**pending, "status": "exported", "export_result": export_result},
    )
    write_run_event(
        run_id, event_type="email.done", status="done", title="Email sent", phase="email",
        detail={"sent": result["sent_count"], "failed": result["failed_count"]},
        batch_id=batch_id, chat_id=chat_id,
    )
    update_assistant_message_metadata_for_run(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        metadata={
            "pending_email_sendable": False,
            "email_sent": True,
            "email_sent_count": result["sent_count"],
            "email_failed_count": result["failed_count"],
        },
    )
    return {"success": True, **result}


@router.post("/{chat_id}/runs/{run_id}/pending-artifact/save-email-draft", response_model=dict)
async def save_pending_email_draft_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Save the staged email as Gmail draft(s) (teacher-confirmed)."""
    lecturer_id: str = current_user["uid"]
    early, pending, content, export_lock_id, mark_failed = _claim_pending_email(
        batch_id, chat_id, run_id, lecturer_id
    )
    if early is not None:
        return early

    recipients = [str(r) for r in content["recipients"]]
    subject = str(content.get("subject") or "")
    body = str(content.get("body") or "")

    write_run_event(
        run_id, event_type="email.draft.started", status="started", title="Saving Gmail draft",
        phase="email", batch_id=batch_id, chat_id=chat_id,
    )
    try:
        assert_google_oauth_valid(lecturer_id, ["gmail.compose"])
        result = save_pending_email_as_draft(
            uid=lecturer_id, recipients=recipients, subject=subject, body=body,
            source_run_id=run_id,
        )
    except (GoogleOAuthRequiredError, GoogleOAuthInvalidError) as exc:
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=GOOGLE_OAUTH_REQUIRED_DETAIL) from exc
    except EmailDispatchError as exc:
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("pending email draft failed run_id=%s", run_id)
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save draft") from exc

    export_result = {"action": "draft", **result}
    mark_agent_run_pending_artifact_exported(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        pending_artifact={**pending, "status": "exported", "export_result": export_result},
    )
    write_run_event(
        run_id, event_type="email.draft.done", status="done", title="Gmail draft saved", phase="email",
        detail={"drafts": result["draft_count"], "failed": result["failed_count"]},
        batch_id=batch_id, chat_id=chat_id,
    )
    update_assistant_message_metadata_for_run(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        metadata={
            "pending_email_sendable": False,
            "email_drafted": True,
            "email_draft_count": result["draft_count"],
            "email_failed_count": result["failed_count"],
        },
    )
    return {"success": True, **result}


@router.post("/{chat_id}/runs/{run_id}/pending-artifact/schedule-email", response_model=dict)
async def schedule_pending_email_endpoint(
    batch_id: str,
    chat_id: str,
    run_id: str,
    body: SchedulePendingEmailRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Schedule the staged email for a future time (drained by the send cron)."""
    lecturer_id: str = current_user["uid"]

    send_at = body.send_at
    if send_at.tzinfo is None:
        send_at = send_at.replace(tzinfo=timezone.utc)
    if send_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Scheduled time must be in the future.")

    early, pending, content, export_lock_id, mark_failed = _claim_pending_email(
        batch_id, chat_id, run_id, lecturer_id
    )
    if early is not None:
        return early

    recipients = [str(r) for r in content["recipients"]]
    subject = str(content.get("subject") or "")
    body_text = str(content.get("body") or "")

    try:
        assert_google_oauth_valid(lecturer_id, ["gmail.send"])
        result = schedule_pending_email(
            uid=lecturer_id, recipients=recipients, subject=subject, body=body_text,
            send_at=send_at, source_run_id=run_id,
        )
    except (GoogleOAuthRequiredError, GoogleOAuthInvalidError) as exc:
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=GOOGLE_OAUTH_REQUIRED_DETAIL) from exc
    except Exception as exc:
        logger.exception("pending email schedule failed run_id=%s", run_id)
        mark_failed(str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to schedule email") from exc

    export_result = {"action": "scheduled", **result}
    mark_agent_run_pending_artifact_exported(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        pending_artifact={**pending, "status": "exported", "export_result": export_result},
    )
    write_run_event(
        run_id, event_type="email.scheduled", status="done", title="Email scheduled", phase="email",
        detail={"send_at": result["send_at"], "recipients": result["recipient_count"]},
        batch_id=batch_id, chat_id=chat_id,
    )
    update_assistant_message_metadata_for_run(
        batch_id=batch_id, chat_id=chat_id, run_id=run_id,
        metadata={
            "pending_email_sendable": False,
            "email_scheduled": True,
            "email_send_at": result["send_at"],
        },
    )
    return {"success": True, **result}
