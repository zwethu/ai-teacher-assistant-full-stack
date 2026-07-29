"""Phase D: cron handlers registered + APScheduler gated to local mode."""

import asyncio
from unittest.mock import MagicMock

from services import cloud_tasks


def test_all_cron_handlers_registered():
    import routers.tasks  # noqa: F401 — registers handlers at import
    for path in (
        "/tasks/cron/send-emails",
        "/tasks/cron/cleanup-attachments",
        "/tasks/cron/reconcile-attachments",
        "/tasks/cron/recover-files",
        "/tasks/cron/attachment-watchdog",
        "/tasks/cron/sweep-workflow-chats",
    ):
        assert path in cloud_tasks._LOCAL_HANDLERS, path


def test_sweep_workflow_chats_handler_invokes_service(monkeypatch):
    from routers import tasks as t
    called = MagicMock()
    monkeypatch.setattr("services.chat_service.sweep_stale_workflow_chats", called)
    asyncio.run(t._handle_cron_sweep_workflow_chats({}))
    called.assert_called_once()


def test_cron_handler_invokes_service(monkeypatch):
    from routers import tasks as t
    called = MagicMock()
    monkeypatch.setattr("services.chat_attachment_service.cleanup_expired_attachments", called)
    asyncio.run(t._handle_cron_cleanup_attachments({}))
    called.assert_called_once()


def test_scheduler_skipped_when_cloud_tasks_enabled(monkeypatch):
    import services.maintenance_scheduler as ms
    monkeypatch.setenv("CLOUD_TASKS_ENABLED", "true")
    ms._scheduler = None
    ms.start_scheduler()
    assert ms._scheduler is None  # Cloud Scheduler owns cron in prod


def test_scheduler_starts_in_local_mode(monkeypatch):
    import services.maintenance_scheduler as ms
    monkeypatch.delenv("CLOUD_TASKS_ENABLED", raising=False)
    fake = MagicMock()
    fake.running = False
    monkeypatch.setattr(ms, "BackgroundScheduler", lambda: fake)
    ms._scheduler = None
    ms.start_scheduler()
    assert fake.start.called and fake.add_job.called
    ms._scheduler = None
