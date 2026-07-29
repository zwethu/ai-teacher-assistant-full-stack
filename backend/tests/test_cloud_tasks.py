"""Cloud Tasks wrapper: local inline dispatch, prod enqueue, idempotent handler."""

import asyncio
from unittest.mock import MagicMock

import pytest

from services import cloud_tasks
from services import chat_attachment_service as svc


def test_local_inline_dispatch_runs_handler_directly(monkeypatch):
    monkeypatch.delenv("CLOUD_TASKS_ENABLED", raising=False)
    seen = {}

    async def handler(payload):
        seen.update(payload)

    cloud_tasks.register_local_handler("/tasks/demo", handler)
    # No background_tasks -> runs inline (test/sync context).
    cloud_tasks.enqueue("q", "/tasks/demo", {"x": 1})
    assert seen == {"x": 1}


def test_local_dispatch_via_background_tasks(monkeypatch):
    monkeypatch.delenv("CLOUD_TASKS_ENABLED", raising=False)
    calls = []

    async def handler(payload):
        calls.append(payload)

    cloud_tasks.register_local_handler("/tasks/demo2", handler)
    bg = MagicMock()
    cloud_tasks.enqueue("q", "/tasks/demo2", {"y": 2}, background_tasks=bg)
    # Deferred to the response: registered on BackgroundTasks, not run yet.
    assert bg.add_task.called
    fn, path, payload = bg.add_task.call_args[0]
    assert path == "/tasks/demo2" and payload == {"y": 2}


def test_prod_enqueue_creates_cloud_task(monkeypatch):
    monkeypatch.setenv("CLOUD_TASKS_ENABLED", "true")
    monkeypatch.setenv("SERVICE_URL", "https://svc.example.run.app")
    monkeypatch.setenv("CLOUD_TASKS_SERVICE_ACCOUNT", "tasks@proj.iam.gserviceaccount.com")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
    monkeypatch.setenv("CLOUD_TASKS_LOCATION", "us-central1")

    created = {}
    client = MagicMock()
    client.queue_path.side_effect = lambda p, l, q: f"projects/{p}/locations/{l}/queues/{q}"
    client.create_task.side_effect = lambda parent, task: created.update(parent=parent, task=task)

    fake_module = MagicMock()
    fake_module.CloudTasksClient.return_value = client
    fake_module.HttpMethod.POST = "POST"
    monkeypatch.setitem(__import__("sys").modules, "google.cloud.tasks_v2", fake_module)

    cloud_tasks.enqueue("attachments", "/tasks/process-attachment", {"attachment_id": "a1"})

    assert created["parent"].endswith("/queues/attachments")
    req = created["task"]["http_request"]
    assert req["url"] == "https://svc.example.run.app/tasks/process-attachment"
    assert req["oidc_token"]["audience"] == "https://svc.example.run.app"
    assert req["oidc_token"]["service_account_email"] == "tasks@proj.iam.gserviceaccount.com"


def test_prod_enqueue_drops_task_when_unconfigured(monkeypatch, caplog):
    monkeypatch.setenv("CLOUD_TASKS_ENABLED", "true")
    monkeypatch.delenv("SERVICE_URL", raising=False)
    monkeypatch.delenv("CLOUD_TASKS_SERVICE_ACCOUNT", raising=False)
    # Must not raise — logs an error and drops.
    cloud_tasks.enqueue("attachments", "/tasks/process-attachment", {"attachment_id": "a1"})


def test_process_attachment_is_idempotent_on_terminal_doc(monkeypatch):
    """A duplicate task delivery on an already-ready doc is a no-op."""
    ref = MagicMock()
    snap = ref.get.return_value
    snap.exists = True
    snap.to_dict.return_value = {"status": "ready", "attachment_kind": "document",
                                 "content_type": "text/plain", "gcs_path": "gs://b/x.txt"}
    monkeypatch.setattr(svc, "get_firestore", lambda: MagicMock())
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: ref)
    downloaded = MagicMock()
    monkeypatch.setattr(svc, "download_bytes", downloaded)
    svc.process_chat_attachment("b1", "c1", "att-1")
    ref.update.assert_not_called()      # no re-processing
    downloaded.assert_not_called()      # no re-download / no vision re-bill


def test_process_attachment_handler_calls_service(monkeypatch):
    from routers import tasks as tasks_router
    called = {}
    monkeypatch.setattr(tasks_router, "process_chat_attachment",
                        lambda b, c, a: called.update(batch=b, chat=c, att=a))
    asyncio.run(tasks_router._handle_process_attachment(
        {"batch_id": "b1", "chat_id": "c1", "attachment_id": "a1"}))
    assert called == {"batch": "b1", "chat": "c1", "att": "a1"}
