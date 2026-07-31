"""Dispatch emails staged from chat: immediate Gmail send + scheduling via the
``emails`` collection (drained by ``email_scheduler.check_and_send_emails``).

Sending is backend-owned. The chat agent only stages the recipients/subject/body;
these helpers perform the actual Gmail send after the teacher confirms in the UI.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP

from services.gmail_service import GmailSendError, create_draft, send_email
from services.google_workspace.credentials import read_refresh_token
from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

EMAILS_COLLECTION = "emails"


class EmailDispatchError(Exception):
    """Raised when a staged email could not be dispatched at all."""


def _joined(recipients: list[str]) -> str:
    return ", ".join(recipients)


def send_pending_email_now(
    *,
    uid: str,
    recipients: list[str],
    subject: str,
    body: str,
    source_run_id: str = "",
) -> dict[str, Any]:
    """Send one Gmail message per recipient, then record a history doc.

    Sending individually avoids disclosing the class roster in the ``To`` header.
    Raises :class:`EmailDispatchError` only if *every* send fails; partial failures
    are reported in the return payload.
    """
    db = get_firestore()
    refresh_token = read_refresh_token(db, uid)
    if not refresh_token:
        raise EmailDispatchError("Google account not connected.")

    sent: list[str] = []
    failed: list[dict[str, str]] = []
    for to in recipients:
        try:
            send_email(refresh_token, to, subject, body)
            sent.append(to)
        except Exception as exc:  # GmailSendError or transport failure
            logger.warning(
                "chat email send failed to=%s run_id=%s: %s", to, source_run_id, exc
            )
            failed.append({"to": to, "error": str(exc)[:300]})

    if not sent:
        detail = failed[0]["error"] if failed else "No recipients."
        raise EmailDispatchError(f"Failed to send email: {detail}")

    now = datetime.now(timezone.utc)
    try:
        # Both snake_case (backend/cron) and camelCase (Email history page) keys.
        db.collection(EMAILS_COLLECTION).add(
            {
                "uid": uid,
                "to": _joined(sent),
                "recipients": sent,
                "subject": subject,
                "body": body,
                "status": "sent",
                "sent_at": now,
                "sentAt": now,
                "created_at": SERVER_TIMESTAMP,
                "createdAt": SERVER_TIMESTAMP,
                "source_run_id": source_run_id,
            }
        )
    except Exception as exc:
        logger.warning(
            "failed to record sent-email history run_id=%s: %s", source_run_id, exc
        )

    return {
        "sent_count": len(sent),
        "failed_count": len(failed),
        "recipients": sent,
        "failed": failed,
    }


def save_pending_email_as_draft(
    *,
    uid: str,
    recipients: list[str],
    subject: str,
    body: str,
    source_run_id: str = "",
) -> dict[str, Any]:
    """Create one Gmail draft per recipient, then record a history doc."""
    db = get_firestore()
    refresh_token = read_refresh_token(db, uid)
    if not refresh_token:
        raise EmailDispatchError("Google account not connected.")

    saved: list[str] = []
    failed: list[dict[str, str]] = []
    for to in recipients:
        try:
            create_draft(refresh_token, to, subject, body)
            saved.append(to)
        except Exception as exc:
            logger.warning(
                "chat email draft failed to=%s run_id=%s: %s", to, source_run_id, exc
            )
            failed.append({"to": to, "error": str(exc)[:300]})

    if not saved:
        detail = failed[0]["error"] if failed else "No recipients."
        raise EmailDispatchError(f"Failed to create draft: {detail}")

    now = datetime.now(timezone.utc)
    try:
        db.collection(EMAILS_COLLECTION).add(
            {
                "uid": uid,
                "to": _joined(saved),
                "recipients": saved,
                "subject": subject,
                "body": body,
                "status": "draft",
                "drafted_at": now,
                "draftedAt": now,
                "created_at": SERVER_TIMESTAMP,
                "createdAt": SERVER_TIMESTAMP,
                "source_run_id": source_run_id,
            }
        )
    except Exception as exc:
        logger.warning(
            "failed to record draft-email history run_id=%s: %s", source_run_id, exc
        )

    return {
        "draft_count": len(saved),
        "failed_count": len(failed),
        "recipients": saved,
        "failed": failed,
    }


def schedule_pending_email(
    *,
    uid: str,
    recipients: list[str],
    subject: str,
    body: str,
    send_at: datetime,
    source_run_id: str = "",
) -> dict[str, Any]:
    """Persist a pending email for the send cron (``check_and_send_emails``).

    Stores ``recipients`` as a list; the cron sends one message per recipient.
    """
    if send_at.tzinfo is None:
        send_at = send_at.replace(tzinfo=timezone.utc)

    db = get_firestore()
    _, ref = db.collection(EMAILS_COLLECTION).add(
        {
            "uid": uid,
            "to": _joined(recipients),
            "recipients": recipients,
            "subject": subject,
            "body": body,
            "status": "pending",
            # Both snake_case (cron query) and camelCase (Email history page) keys.
            "send_at": send_at,
            "sendAt": send_at,
            "created_at": SERVER_TIMESTAMP,
            "createdAt": SERVER_TIMESTAMP,
            "source_run_id": source_run_id,
        }
    )
    return {
        "email_id": ref.id,
        "recipient_count": len(recipients),
        "send_at": send_at.isoformat(),
    }
