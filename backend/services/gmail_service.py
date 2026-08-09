import base64
from email.mime.text import MIMEText
from typing import Any

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from utils.google_credentials import google_oauth_client


class GmailSendError(Exception):
    """Raised when sending an email through Gmail fails."""


def _gmail_client(refresh_token: str):
    client_id, client_secret = google_oauth_client()
    if not client_id or not client_secret:
        raise GmailSendError(
            "Google OAuth client is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)"
        )

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
    )
    creds.refresh(GoogleAuthRequest())
    return build("gmail", "v1", credentials=creds)


def _raw_message(to: str, subject: str, body: str) -> str:
    mime_message = MIMEText(body)
    mime_message["To"] = to
    mime_message["Subject"] = subject
    return base64.urlsafe_b64encode(mime_message.as_bytes()).decode()


def send_email(
    refresh_token: str,
    to: str,
    subject: str,
    body: str,
) -> dict[str, Any]:
    """
    Send an email via Gmail API using a stored OAuth refresh token.

    Returns the Gmail API message resource from messages().send().
    """
    try:
        service = _gmail_client(refresh_token)
        return (
            service.users()
            .messages()
            .send(userId="me", body={"raw": _raw_message(to, subject, body)})
            .execute()
        )
    except GmailSendError:
        raise
    except Exception as exc:
        raise GmailSendError(f"Failed to send email via Gmail: {exc}") from exc


def create_draft(
    refresh_token: str,
    to: str,
    subject: str,
    body: str,
) -> dict[str, Any]:
    """Create a Gmail draft. Returns the Gmail draft resource (with its ``id``)."""
    try:
        service = _gmail_client(refresh_token)
        return (
            service.users()
            .drafts()
            .create(
                userId="me",
                body={"message": {"raw": _raw_message(to, subject, body)}},
            )
            .execute()
        )
    except GmailSendError:
        raise
    except Exception as exc:
        raise GmailSendError(f"Failed to create Gmail draft: {exc}") from exc


def send_draft(refresh_token: str, draft_id: str) -> dict[str, Any]:
    """Send an existing Gmail draft.

    Sending the draft itself (rather than composing an equivalent new message)
    is what removes it from the user's Drafts folder — otherwise the draft would
    linger next to the sent copy.
    """
    try:
        service = _gmail_client(refresh_token)
        return (
            service.users()
            .drafts()
            .send(userId="me", body={"id": draft_id})
            .execute()
        )
    except GmailSendError:
        raise
    except Exception as exc:
        raise GmailSendError(f"Failed to send Gmail draft: {exc}") from exc
