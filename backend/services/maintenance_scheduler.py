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

def _scheduler_enabled() -> bool:
    """Opt out of the local cron entirely. These sweeps read Firestore on a timer
    whether or not anyone is using the app, so a dev server left running overnight
    burns quota for nothing. Trigger any sweep by hand via /tasks/cron/* instead."""
    return (os.getenv("MAINTENANCE_SCHEDULER_ENABLED") or "true").strip().lower() != "false"


def start_scheduler() -> None:
    """Local-dev cron. In production (CLOUD_TASKS_ENABLED=true) Cloud Scheduler drives
    the /tasks/cron/* endpoints instead, so the in-process scheduler stays off."""
    global _scheduler
    from services.cloud_tasks import cloud_tasks_enabled
    if cloud_tasks_enabled():
        logger.info("Cloud Tasks enabled — cron handled by Cloud Scheduler; APScheduler not started")
        return
    if not _scheduler_enabled():
        logger.info("MAINTENANCE_SCHEDULER_ENABLED=false — local cron not started")
        return
    if _scheduler and _scheduler.running: return
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(check_and_send_emails, "interval", minutes=2, id="scheduled-emails", max_instances=1)
    # 15 min, not 2: run_index_file_task takes a 120-minute recovery lease, so a
    # faster sweep just re-reads the same files and enqueues tasks that no-op.
    _scheduler.add_job(recover_batch_files, "interval", minutes=15, id="file-recovery", max_instances=1)
    _scheduler.add_job(cleanup_expired_attachments, "interval", hours=1, id="attachment-cleanup", max_instances=1)
    _scheduler.add_job(run_attachment_reconciliation, "interval", weeks=1, id="attachment-reconciliation", max_instances=1)
    _scheduler.add_job(sweep_stale_workflow_chats, "interval", days=1, id="workflow-chat-sweep", max_instances=1)
    # Backstop only: every deferred run now schedules its own /tasks/attachment-deadline
    # check, so this just covers a dropped task or a restart that lost the local timer.
    _scheduler.add_job(_run_attachment_watchdog, "interval", minutes=30, id="attachment-watchdog", max_instances=1)
    _scheduler.start(); logger.info("Maintenance scheduler started")

def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running: _scheduler.shutdown(wait=False)
    _scheduler = None
