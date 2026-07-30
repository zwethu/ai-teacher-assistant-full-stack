import logging
import os
from apscheduler.schedulers.background import BackgroundScheduler
from services.email_scheduler import check_and_send_emails
from services.chat_attachment_service import cleanup_expired_attachments, run_attachment_reconciliation
from services.chat_service import sweep_stale_workflow_chats
from services.file_service import recover_batch_files


def _run_attachment_watchdog() -> None:
    # Lazy import avoids a circular import at module load (agent_gateway -> chat_service -> ...).
    from services.agent_gateway import run_attachment_watchdog
    run_attachment_watchdog()

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def start_scheduler() -> None:
    """Local-dev cron. In production (CLOUD_TASKS_ENABLED=true) Cloud Scheduler drives
    the /tasks/cron/* endpoints instead, so the in-process scheduler stays off.

    Two env knobs (local dev only — ignored when Cloud Tasks is enabled) keep these
    crons from silently draining Firestore read quota:
      - ENABLE_LOCAL_SCHEDULER=false → run the backend with NO background crons.
      - *_INTERVAL_MINUTES           → override how often each cron runs.
    The watchdog and file-recovery sweeps re-read on every tick, so their defaults are
    deliberately gentle; the email sweep stays at 2m so scheduled sends fire promptly.
    """
    global _scheduler
    from services.cloud_tasks import cloud_tasks_enabled
    if cloud_tasks_enabled():
        logger.info("Cloud Tasks enabled — cron handled by Cloud Scheduler; APScheduler not started")
        return
    if not _env_flag("ENABLE_LOCAL_SCHEDULER", True):
        logger.info("ENABLE_LOCAL_SCHEDULER=false — maintenance crons disabled for this process")
        return
    if _scheduler and _scheduler.running: return

    email_min = _env_int("EMAIL_SEND_INTERVAL_MINUTES", 2)
    recover_min = _env_int("FILE_RECOVERY_INTERVAL_MINUTES", 10)  # was 2
    watchdog_min = _env_int("ATTACHMENT_WATCHDOG_INTERVAL_MINUTES", 5)  # was 1

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(check_and_send_emails, "interval", minutes=email_min, id="scheduled-emails", max_instances=1)
    _scheduler.add_job(recover_batch_files, "interval", minutes=recover_min, id="file-recovery", max_instances=1)
    _scheduler.add_job(cleanup_expired_attachments, "interval", hours=1, id="attachment-cleanup", max_instances=1)
    _scheduler.add_job(run_attachment_reconciliation, "interval", weeks=1, id="attachment-reconciliation", max_instances=1)
    _scheduler.add_job(sweep_stale_workflow_chats, "interval", days=1, id="workflow-chat-sweep", max_instances=1)
    _scheduler.add_job(_run_attachment_watchdog, "interval", minutes=watchdog_min, id="attachment-watchdog", max_instances=1)
    _scheduler.start()
    logger.info(
        "Maintenance scheduler started (email=%dm file-recovery=%dm watchdog=%dm)",
        email_min, recover_min, watchdog_min,
    )

def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running: _scheduler.shutdown(wait=False)
    _scheduler = None
