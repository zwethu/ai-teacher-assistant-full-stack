from fastapi import APIRouter, Depends, HTTPException, status

from entity.email import (
    GenerateEmailRequest,
    SaveDraftRequest,
    SendDraftRequest,
    SendEmailRequest,
)
from services.email_ai import EmailAiError, generate_email_draft
from services.gmail_service import GmailSendError, create_draft, send_draft, send_email
from services.google_workspace.credentials import read_refresh_token
from utils.firebase_auth import CurrentUser, get_current_user
from utils.firestore_client import get_firestore

router = APIRouter(prefix="/email")

USERS_COLLECTION = "users"


def _get_user_refresh_token(uid: str) -> str:
    db = get_firestore()
    # Token lives in the Admin-only private subdoc (with legacy fallback).
    token = read_refresh_token(db, uid)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Google account not connected. Please grant permissions first.",
        )
    return token


@router.post("/generate")
async def generate(
    payload: GenerateEmailRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    """Draft subject + body from a lecturer prompt via Vertex Gemini."""
    # Signature comes from the verified token, never the client payload.
    sender_name = str(current_user.get("name") or "").strip()
    try:
        return generate_email_draft(
            prompt=payload.prompt,
            batch_name=payload.batch_name,
            course_name=payload.course_name,
            sender_name=sender_name,
        )
    except EmailAiError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


@router.post("/save-draft")
async def save_draft(
    payload: SaveDraftRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, bool | str]:
    """Save an email as a Gmail draft using the user's stored refresh token."""
    uid = current_user["uid"]
    refresh_token = _get_user_refresh_token(uid)

    try:
        draft = create_draft(
            refresh_token,
            payload.to,
            payload.subject,
            payload.body,
        )
    except GmailSendError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create draft: {exc}",
        ) from exc

    # The draft id lets the client send this exact draft later, which also
    # clears it out of Gmail's Drafts folder.
    return {
        "success": True,
        "message": "Draft saved to Gmail",
        "draft_id": str(draft.get("id") or ""),
    }


@router.post("/send-draft")
async def send_saved_draft(
    payload: SendDraftRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, bool | str]:
    """Send a Gmail draft the user previously saved."""
    uid = current_user["uid"]
    refresh_token = _get_user_refresh_token(uid)

    try:
        send_draft(refresh_token, payload.draft_id)
    except GmailSendError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send draft: {exc}",
        ) from exc

    return {"success": True, "message": "Draft sent"}


@router.post("/send-now")
async def send_now(
    payload: SendEmailRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, bool | str]:
    """Send an email immediately via Gmail using the user's stored refresh token."""
    uid = current_user["uid"]
    refresh_token = _get_user_refresh_token(uid)

    try:
        send_email(
            refresh_token,
            payload.to,
            payload.subject,
            payload.body,
        )
    except GmailSendError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send email: {exc}",
        ) from exc

    return {"success": True, "message": "Email sent successfully"}
