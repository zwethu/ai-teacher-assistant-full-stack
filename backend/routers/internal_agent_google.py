"""Internal agent gateway for Google Workspace side effects.

Exposes internal endpoints for Pnai-ai Agent Engine to call.
Protected by X-PNAI-Agent-Secret header.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Header, HTTPException, status, Response
from pydantic import BaseModel

from services.artifact_service import (
    complete_artifact,
    fail_reserved_artifact,
    reserve_artifact,
)
from services.google_workspace.drive_folders import (
    build_artifact_file_name,
    ensure_batch_artifact_folders,
)
from services.google_workspace.calendar_service import create_calendar_event_for_user
from services.google_workspace.credentials import assert_google_oauth_valid
from services.google_workspace.docs_service import (
    create_lab_docs_for_user,
    create_lesson_plan_doc_for_user,
    read_doc_content_for_user,
    read_doc_structured_for_user,
    export_doc_as_pdf_for_user,
)
from services.google_workspace.forms_service import create_quiz_form_for_user
from services.google_workspace.gmail_service import (
    create_email_draft_for_user,
    send_email_for_user,
)
from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/agent/google")

GOOGLE_CONNECTOR_DISABLED_DETAIL = {
    "code": "GOOGLE_CONNECTOR_DISABLED",
    "message": "Google Workspace connector is not enabled.",
}
GOOGLE_OAUTH_REQUIRED_DETAIL = {
    "code": "GOOGLE_OAUTH_REQUIRED",
    "message": "Google OAuth connection is required for Google Workspace actions.",
    "connect_url": "/auth/google-scopes",
}
EMAIL_SEND_CONFIRMATION_REQUIRED_DETAIL = {
    "code": "EMAIL_SEND_CONFIRMATION_REQUIRED",
    "message": "Email sending requires explicit user confirmation.",
}


def _verify_secret(secret: str) -> None:
    expected = os.getenv("PNAI_AGENT_SHARED_SECRET")
    if not expected or not secret or secret != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-PNAI-Agent-Secret",
        )


def _validate_run_and_oauth(
    batch_id: str,
    chat_id: str,
    run_id: str,
    lecturer_id: str,
) -> None:
    """Check that the run exists, connectors are enabled, and OAuth is valid."""
    db = get_firestore()
    run_ref = (
        db.collection("batches")
        .document(batch_id)
        .collection("chats")
        .document(chat_id)
        .collection("runs")
        .document(run_id)
    )
    run_snap = run_ref.get()
    if not run_snap.exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent run not found",
        )

    run_data = run_snap.to_dict() or {}
    
    # Check if the lecturer ID matches
    if run_data.get("lecturer_id") != lecturer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Lecturer ID mismatch",
        )

    # Check connector toggle
    connectors = run_data.get("connectors") or {}
    if not connectors.get("google_workspace"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=GOOGLE_CONNECTOR_DISABLED_DETAIL,
        )

    # Check OAuth validity
    try:
        assert_google_oauth_valid(lecturer_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=GOOGLE_OAUTH_REQUIRED_DETAIL,
        ) from exc


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class AgentContext(BaseModel):
    batch_id: str
    chat_id: str
    run_id: str
    lecturer_id: str
    lecturer_email: str
    batch_name: str = ""
    course_name: str = ""


class LessonPlanRequest(BaseModel):
    context: AgentContext
    lesson_plan: dict[str, Any]
    existing_doc_id: str | None = None


class LabRequest(BaseModel):
    context: AgentContext
    lab: dict[str, Any]


class QuizRequest(BaseModel):
    context: AgentContext
    quiz: dict[str, Any]


class EmailRequest(BaseModel):
    context: AgentContext
    subject: str
    body: str
    recipients: list[str]
    confirmed_send: bool = False


class CalendarRequest(BaseModel):
    context: AgentContext
    event: dict[str, Any]


class DocReadRequest(BaseModel):
    context: AgentContext
    doc_id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/docs/lesson-plan")
async def create_lesson_plan(
    req: LessonPlanRequest,
    x_pnai_agent_secret: str = Header(None),
) -> dict[str, Any]:
    _verify_secret(x_pnai_agent_secret)
    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)

    week = req.lesson_plan.get("week", 1)
    title = req.lesson_plan.get("title", "Lesson Plan")
    reservation = reserve_artifact(
        batch_id=ctx.batch_id,
        artifact_type="lesson_plan",
        week=week,
        title=title,
        created_by=ctx.lecturer_id,
        batch_name=ctx.batch_name,
        course_name=ctx.course_name,
    )
    artifact_id = reservation["artifact_id"]
    drive_file_name = build_artifact_file_name(
        version=reservation["version"],
        week=week,
        artifact_type="lesson_plan",
        title=title,
    )

    try:
        folders = ensure_batch_artifact_folders(
            uid=ctx.lecturer_id,
            batch_id=ctx.batch_id,
            batch_name=ctx.batch_name,
            course_name=ctx.course_name,
        )
        folder = folders["drive_folders"]["lesson_plan"]
        result = create_lesson_plan_doc_for_user(
            uid=ctx.lecturer_id,
            lesson_plan_payload=req.lesson_plan,
            lecturer_email=ctx.lecturer_email,
            existing_doc_id=req.existing_doc_id,
            target_folder_id=folder["id"],
            drive_file_name=drive_file_name,
        )
        complete_artifact(
            batch_id=ctx.batch_id,
            artifact_id=artifact_id,
            artifact_updates={
                "title": result["title"],
                "doc_url": result["doc_url"],
                "doc_id": result["doc_id"],
                "drive_file_name": result.get("drive_file_name", drive_file_name),
                "drive_folder_id": folder["id"],
                "drive_folder_url": folder["url"],
                "metadata": {},
            },
        )
    except Exception as exc:
        fail_reserved_artifact(ctx.batch_id, artifact_id, str(exc))
        raise

    return {**result, "artifact_id": artifact_id, "version": reservation["version"]}


@router.post("/docs/lab")
async def create_lab(
    req: LabRequest,
    x_pnai_agent_secret: str = Header(None),
) -> dict[str, Any]:
    _verify_secret(x_pnai_agent_secret)
    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)

    week = req.lab.get("week", 1)
    title = req.lab.get("title", "Lab")
    reservation = reserve_artifact(
        batch_id=ctx.batch_id,
        artifact_type="lab",
        week=week,
        title=title,
        created_by=ctx.lecturer_id,
        batch_name=ctx.batch_name,
        course_name=ctx.course_name,
    )
    artifact_id = reservation["artifact_id"]
    lecturer_name = build_artifact_file_name(
        version=reservation["version"],
        week=week,
        artifact_type="lab",
        title=title,
        suffix="Lecturer Guide",
    )
    student_name = build_artifact_file_name(
        version=reservation["version"],
        week=week,
        artifact_type="lab",
        title=title,
        suffix="Student Instructions",
    )

    try:
        folders = ensure_batch_artifact_folders(
            uid=ctx.lecturer_id,
            batch_id=ctx.batch_id,
            batch_name=ctx.batch_name,
            course_name=ctx.course_name,
        )
        folder = folders["drive_folders"]["lab"]
        result = create_lab_docs_for_user(
            uid=ctx.lecturer_id,
            lab_payload=req.lab,
            lecturer_email=ctx.lecturer_email,
            target_folder_id=folder["id"],
            lecturer_drive_file_name=lecturer_name,
            student_drive_file_name=student_name,
        )
        complete_artifact(
            batch_id=ctx.batch_id,
            artifact_id=artifact_id,
            artifact_updates={
                "doc_url": result["lecturer_doc_url"],
                "doc_id": result["lecturer_doc_id"],
                "drive_file_name": result.get("lecturer_drive_file_name", lecturer_name),
                "drive_folder_id": folder["id"],
                "drive_folder_url": folder["url"],
                "metadata": {
                    "student_doc_url": result["student_doc_url"],
                    "student_doc_id": result["student_doc_id"],
                    "student_drive_file_name": result.get("student_drive_file_name", student_name),
                },
            },
        )
    except Exception as exc:
        fail_reserved_artifact(ctx.batch_id, artifact_id, str(exc))
        raise

    return {**result, "artifact_id": artifact_id, "version": reservation["version"]}


@router.post("/docs/read-content")
async def read_doc_content(
    req: DocReadRequest,
    x_pnai_agent_secret: str = Header(None),
) -> dict[str, str]:
    _verify_secret(x_pnai_agent_secret)
    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)
    content = read_doc_content_for_user(ctx.lecturer_id, req.doc_id)
    return {"content": content}


@router.post("/docs/read-structured")
async def read_doc_structured(
    req: DocReadRequest,
    x_pnai_agent_secret: str = Header(None),
) -> dict[str, Any]:
    _verify_secret(x_pnai_agent_secret)
    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)
    return read_doc_structured_for_user(ctx.lecturer_id, req.doc_id)


@router.post("/docs/export-pdf")
async def export_doc_pdf(
    req: DocReadRequest,
    x_pnai_agent_secret: str = Header(None),
) -> Response:
    _verify_secret(x_pnai_agent_secret)
    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)
    pdf_bytes = export_doc_as_pdf_for_user(ctx.lecturer_id, req.doc_id)
    return Response(content=pdf_bytes, media_type="application/pdf")


@router.post("/forms/quiz")
async def create_quiz(
    req: QuizRequest,
    x_pnai_agent_secret: str = Header(None),
) -> dict[str, Any]:
    _verify_secret(x_pnai_agent_secret)
    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)

    # Forms don't strictly have a week, but the agent payload might
    week = req.quiz.get("week", 1)
    title = req.quiz.get("title", "Quiz")
    reservation = reserve_artifact(
        batch_id=ctx.batch_id,
        artifact_type="quiz",
        week=week,
        title=title,
        created_by=ctx.lecturer_id,
        batch_name=ctx.batch_name,
        course_name=ctx.course_name,
    )
    artifact_id = reservation["artifact_id"]
    drive_file_name = build_artifact_file_name(
        version=reservation["version"],
        week=week,
        artifact_type="quiz",
        title=title,
    )

    try:
        folders = ensure_batch_artifact_folders(
            uid=ctx.lecturer_id,
            batch_id=ctx.batch_id,
            batch_name=ctx.batch_name,
            course_name=ctx.course_name,
        )
        folder = folders["drive_folders"]["assessment"]
        result = create_quiz_form_for_user(
            uid=ctx.lecturer_id,
            quiz_payload=req.quiz,
            lecturer_email=ctx.lecturer_email,
            target_folder_id=folder["id"],
            drive_file_name=drive_file_name,
        )
        complete_artifact(
            batch_id=ctx.batch_id,
            artifact_id=artifact_id,
            artifact_updates={
                "title": result["title"],
                "doc_url": result["form_url"],
                "doc_id": result["form_id"],
                "form_url": result["form_url"],
                "form_id": result["form_id"],
                "drive_file_name": result.get("drive_file_name", drive_file_name),
                "drive_folder_id": folder["id"],
                "drive_folder_url": folder["url"],
                "metadata": {
                    "form_url": result["form_url"],
                    "form_id": result["form_id"],
                },
            },
        )
    except Exception as exc:
        fail_reserved_artifact(ctx.batch_id, artifact_id, str(exc))
        raise

    return {**result, "artifact_id": artifact_id, "version": reservation["version"]}


@router.post("/gmail/send")
async def send_email(
    req: EmailRequest,
    x_pnai_agent_secret: str = Header(None),
) -> dict[str, Any]:
    _verify_secret(x_pnai_agent_secret)
    if not req.confirmed_send:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=EMAIL_SEND_CONFIRMATION_REQUIRED_DETAIL,
        )

    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)

    result = send_email_for_user(
        uid=ctx.lecturer_id,
        subject=req.subject,
        body=req.body,
        recipients=req.recipients,
        sender=ctx.lecturer_email,
    )

    return result


@router.post("/gmail/draft")
async def create_draft(
    req: EmailRequest,
    x_pnai_agent_secret: str = Header(None),
) -> dict[str, Any]:
    _verify_secret(x_pnai_agent_secret)
    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)

    result = create_email_draft_for_user(
        uid=ctx.lecturer_id,
        subject=req.subject,
        body=req.body,
        recipients=req.recipients,
        sender=ctx.lecturer_email,
    )

    return result


@router.post("/calendar/event")
async def create_calendar_event(
    req: CalendarRequest,
    x_pnai_agent_secret: str = Header(None),
) -> dict[str, Any]:
    _verify_secret(x_pnai_agent_secret)
    ctx = req.context
    _validate_run_and_oauth(ctx.batch_id, ctx.chat_id, ctx.run_id, ctx.lecturer_id)

    result = create_calendar_event_for_user(
        uid=ctx.lecturer_id,
        event_payload=req.event,
    )

    return result
