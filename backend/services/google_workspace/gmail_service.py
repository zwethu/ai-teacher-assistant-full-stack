"""Gmail API service — creates drafts and sends emails for users.

Uses user OAuth credentials to call the Gmail API.
"""

from __future__ import annotations

import base64
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from services.google_workspace.credentials import build_user_credentials

logger = logging.getLogger(__name__)


def _build_gmail_service(uid: str):
    # Depending on whether the user has re-consented, they might only
    # have gmail.compose. We'll request gmail.send, but credentials builder
    # checks what was actually authorized during auth.
    creds = build_user_credentials(uid, ["gmail.send", "gmail.compose"])
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _build_message(subject: str, body: str, to_emails: list[str], sender: str) -> dict[str, str]:
    """Build a base64-encoded email message for Gmail API."""
    if not to_emails:
        raise ValueError("to_emails must contain at least one email address.")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(to_emails)
    msg.attach(MIMEText(body, "plain"))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    return {"raw": raw}


def send_email_for_user(
    uid: str,
    subject: str,
    body: str,
    recipients: list[str],
    sender: str,
) -> dict[str, Any]:
    """Send an email using the user's Gmail account.

    Returns ``{"sent": True, "recipient_count": int}``.
    """
    service = _build_gmail_service(uid)
    try:
        message = _build_message(subject, body, recipients, sender)
        service.users().messages().send(userId="me", body=message).execute()
        return {"sent": True, "recipient_count": len(recipients)}
    except HttpError as exc:
        logger.error(
            "Failed to send email uid=%s from '%s' to %s: %s",
            uid, sender, recipients, exc,
        )
        raise RuntimeError(f"Failed to send email: {exc}") from exc
    except ValueError as exc:
        logger.error("Invalid email message: %s", exc)
        raise RuntimeError(f"Invalid email message: {exc}") from exc


def create_email_draft_for_user(
    uid: str,
    subject: str,
    body: str,
    recipients: list[str],
    sender: str,
) -> dict[str, Any]:
    """Create a Gmail draft in the user's account.

    Returns ``{"draft_id": "...", "recipient_count": int}``.
    """
    service = _build_gmail_service(uid)
    try:
        message = _build_message(subject, body, recipients, sender)
        draft = (
            service.users()
            .drafts()
            .create(userId="me", body={"message": message})
            .execute()
        )
    except HttpError as exc:
        logger.error(
            "Failed to create draft uid=%s from '%s' to %s: %s",
            uid, sender, recipients, exc,
        )
        raise RuntimeError(f"Failed to create draft: {exc}") from exc
    except ValueError as exc:
        logger.error("Invalid email message: %s", exc)
        raise RuntimeError(f"Invalid email message: {exc}") from exc

    draft_id = draft.get("id")
    if not draft_id:
        raise RuntimeError("Gmail API returned no draft id after create.")

    return {"draft_id": draft_id, "recipient_count": len(recipients)}
