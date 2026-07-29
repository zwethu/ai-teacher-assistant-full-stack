import logging
from datetime import datetime, timezone

from services.gmail_service import GmailSendError, send_email
from services.google_workspace.credentials import read_refresh_token
from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

USERS_COLLECTION = "users"
EMAILS_COLLECTION = "emails"

# NOTE: the scheduling of check_and_send_emails is owned by maintenance_scheduler
# (local dev, APScheduler) or Cloud Scheduler -> /tasks/cron/send-emails (prod).
# The previous standalone APScheduler here was dead code and has been removed.


def check_and_send_emails() -> None:
    """Send pending emails whose send_at time has passed."""
    try:
        db = get_firestore()
        now = datetime.now(timezone.utc)
        pending = (
            db.collection(EMAILS_COLLECTION)
            .where("status", "==", "pending")
            .where("send_at", "<=", now)
            .stream()
        )
    except Exception as exc:
        logger.exception("Failed to query pending emails: %s", exc)
        return

    for doc in pending:
        try:
            data = doc.to_dict() or {}
            uid = data.get("uid")
            if not uid:
                logger.warning("Email %s has no uid; skipping", doc.id)
                continue

            user_snap = db.collection(USERS_COLLECTION).document(uid).get()
            if not user_snap.exists:
                logger.warning(
                    "User %s not found for email %s; skipping", uid, doc.id
                )
                continue

            refresh_token = read_refresh_token(db, uid)
            if not refresh_token:
                logger.warning(
                    "No google_refresh_token for user %s (email %s); skipping",
                    uid,
                    doc.id,
                )
                continue

            subject = data.get("subject")
            body = data.get("body")
            # Chat-staged batch emails carry a `recipients` list (one send per
            # recipient, no roster disclosure); standalone emails carry a single `to`.
            recipients_raw = data.get("recipients")
            if isinstance(recipients_raw, list) and recipients_raw:
                recipients = [str(r) for r in recipients_raw if str(r).strip()]
            else:
                to = data.get("to")
                recipients = [str(to)] if to else []
            if not recipients or not subject or not body:
                logger.warning(
                    "Email %s missing recipients/subject/body; skipping", doc.id
                )
                continue

            for recipient in recipients:
                send_email(refresh_token, recipient, str(subject), str(body))

            sent_at = datetime.now(timezone.utc)
            # Both casings: snake_case for the backend, camelCase for the Email page.
            doc.reference.update(
                {"status": "sent", "sent_at": sent_at, "sentAt": sent_at}
            )
            logger.info(
                "Sent scheduled email %s to %d recipient(s)", doc.id, len(recipients)
            )
        except GmailSendError as exc:
            logger.error("Failed to send email %s: %s", doc.id, exc)
        except Exception as exc:
            logger.error("Failed to process email %s: %s", doc.id, exc)
