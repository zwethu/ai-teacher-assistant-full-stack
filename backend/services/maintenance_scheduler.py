import logging
from apscheduler.schedulers.background import BackgroundScheduler
from services.email_scheduler import check_and_send_emails
from services.chat_attachment_service import cleanup_expired_attachments
from services.file_service import recover_batch_files

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None

def start_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running: return
    _scheduler = BackgroundScheduler()
    _scheduler.add_job(check_and_send_emails, "interval", minutes=2, id="scheduled-emails", max_instances=1)
    _scheduler.add_job(recover_batch_files, "interval", minutes=2, id="file-recovery", max_instances=1)
    _scheduler.add_job(cleanup_expired_attachments, "interval", hours=1, id="attachment-cleanup", max_instances=1)
    _scheduler.start(); logger.info("Maintenance scheduler started")

def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running: _scheduler.shutdown(wait=False)
    _scheduler = None
