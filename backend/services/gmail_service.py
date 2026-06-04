import base64
import os
from email.mime.text import MIMEText
from typing import Any

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build


class GmailSendError(Exception):
    """Raised when sending an email through Gmail fails."""


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
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise GmailSendError(
            "Google OAuth client is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)"
        )

    try:
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
        )
        creds.refresh(GoogleAuthRequest())

        service = build("gmail", "v1", credentials=creds)

        mime_message = MIMEText(body)
        mime_message["To"] = to
        mime_message["Subject"] = subject
        encoded = base64.urlsafe_b64encode(mime_message.as_bytes()).decode()

        return (
            service.users()
            .messages()
            .send(userId="me", body={"raw": encoded})
            .execute()
        )
    except GmailSendError:
        raise
    except Exception as exc:
        raise GmailSendError(f"Failed to send email via Gmail: {exc}") from exc
