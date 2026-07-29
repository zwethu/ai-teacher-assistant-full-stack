from fastapi import APIRouter, Depends, HTTPException, status

from entity.email import SendEmailRequest
from services.gmail_service import GmailSendError, send_email
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
