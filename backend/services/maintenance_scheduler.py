import logging
from apscheduler.schedulers.background import BackgroundScheduler
from services.email_scheduler import check_and_send_emails
from services.chat_attachment_service import cleanup_expired_attachments, run_attachment_reconciliation
from services.file_service import recover_batch_files


def _run_attachment_watchdog() -> None:
    # Lazy import avoids a circular import at module load (agent_gateway -> chat_service -> ...).
    from services.agent_gateway import run_attachment_watchdog
    run_attachment_watchdog()

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None

def start_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running: return
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(check_and_send_emails, "interval", minutes=2, id="scheduled-emails", max_instances=1)
    _scheduler.add_job(recover_batch_files, "interval", minutes=2, id="file-recovery", max_instances=1)
    _scheduler.add_job(cleanup_expired_attachments, "interval", hours=1, id="attachment-cleanup", max_instances=1)
    _scheduler.add_job(run_attachment_reconciliation, "interval", weeks=1, id="attachment-reconciliation", max_instances=1)
    _scheduler.add_job(_run_attachment_watchdog, "interval", minutes=1, id="attachment-watchdog", max_instances=1)
    _scheduler.start(); logger.info("Maintenance scheduler started")

def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running: _scheduler.shutdown(wait=False)
    _scheduler = None
