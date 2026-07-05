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

            to = data.get("to")
            subject = data.get("subject")
            body = data.get("body")
            if not to or not subject or not body:
                logger.warning(
                    "Email %s missing to/subject/body; skipping", doc.id
                )
                continue

            send_email(refresh_token, str(to), str(subject), str(body))

            sent_at = datetime.now(timezone.utc)
            doc.reference.update({"status": "sent", "sent_at": sent_at})
            logger.info("Sent scheduled email %s to %s", doc.id, to)
        except GmailSendError as exc:
            logger.error("Failed to send email %s: %s", doc.id, exc)
        except Exception as exc:
            logger.error("Failed to process email %s: %s", doc.id, exc)
