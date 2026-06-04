import base64
import os
import uuid
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import BaseModel, Field

from utils.firebase_auth import CurrentUser, get_current_user
from utils.firestore_client import get_firestore

router = APIRouter()

USERS_COLLECTION = "users"
EMAILS_COLLECTION = "emails"

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
]


class SendNowRequest(BaseModel):
    to: str = Field(..., min_length=3)
    subject: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)


def _credentials_from_refresh_token(refresh_token: str) -> Credentials:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth client is not configured",
        )

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=GMAIL_SCOPES,
    )
    creds.refresh(GoogleAuthRequest())
    return creds


def _build_raw_message(*, to: str, subject: str, body: str) -> dict[str, str]:
    msg = MIMEMultipart("alternative")
    msg.attach(MIMEText(body, "plain"))
    msg["To"] = to
    msg["Subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    return {"raw": raw}


def _get_user_refresh_token(uid: str) -> str:
    db = get_firestore()
    snap = db.collection(USERS_COLLECTION).document(uid).get()
    if not snap.exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile not found",
        )
    token = (snap.to_dict() or {}).get("google_refresh_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Google Workspace permissions not granted. Connect Google scopes first.",
        )
    return token


@router.post("/send-now")
async def send_now(
    payload: SendNowRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Send an email immediately via Gmail using the user's stored refresh token."""
    uid = current_user["uid"]
    refresh_token = _get_user_refresh_token(uid)

    try:
        creds = _credentials_from_refresh_token(refresh_token)
        service = build("gmail", "v1", credentials=creds)
        message = _build_raw_message(
            to=str(payload.to),
            subject=payload.subject,
            body=payload.body,
        )
        gmail_response = (
            service.users()
            .messages()
            .send(userId="me", body=message)
            .execute()
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send email: {exc}",
        ) from exc

    email_id = str(uuid.uuid4())
    sent_at = datetime.now(timezone.utc)
    db = get_firestore()
    db.collection(EMAILS_COLLECTION).document(email_id).set(
        {
            "uid": uid,
            "to": str(payload.to),
            "subject": payload.subject,
            "body": payload.body,
            "status": "sent",
            "sendAt": None,
            "sentAt": sent_at,
            "gmail_message_id": gmail_response.get("id"),
            "created_at": SERVER_TIMESTAMP,
        }
    )

    return {
        "ok": True,
        "id": email_id,
        "gmailMessageId": gmail_response.get("id"),
        "sentAt": sent_at.isoformat(),
    }
