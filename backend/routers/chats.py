"""Chat and message endpoints for batch-scoped conversations."""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from services.agent_gateway import start_chat_run
from services.agent_sessions import (
    claim_pending_artifact_export,
    get_agent_run,
    invalidate_latest_outline_for_followup,
    mark_agent_run_pending_artifact_export_failed,
    mark_agent_run_pending_artifact_exported,
)
from services.artifact_service import (
    content_hash,
    export_lab_draft_to_google_docs,
    export_lesson_plan_draft_to_google_docs,
    export_quiz_draft_to_google_forms,
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
    assert_google_oauth_valid,
)
from utils.firebase_auth import CurrentUser, get_current_user
from utils.rtdb_client import write_run_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/batches/{batch_id}/chats", tags=["chats"])

GOOGLE_OAUTH_REQUIRED_DETAIL = {
    "code": "GOOGLE_OAUTH_REQUIRED",
    "message": "Connect Google Workspace before exporting.",
    "connect_url": "/auth/google-scopes",
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
