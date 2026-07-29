"""Cloud Tasks enqueue wrapper with a local inline fallback.

Prod (`CLOUD_TASKS_ENABLED=true`): create a Cloud Task that POSTs to a `/tasks/*`
handler on this service, authenticated with an OIDC token.

Local/dev/tests (`CLOUD_TASKS_ENABLED` unset/false): run the registered handler
in-process — via the request's BackgroundTasks when available, else directly — so
nothing needs GCP. Handlers must be idempotent (Cloud Tasks retries).
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

# handler_path -> async callable(payload dict). Populated by routers/tasks.py at import.
_LOCAL_HANDLERS: dict[str, Callable[[dict[str, Any]], Awaitable[None]]] = {}


def register_local_handler(handler_path: str, fn: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
    _LOCAL_HANDLERS[handler_path] = fn


def cloud_tasks_enabled() -> bool:
    return (os.getenv("CLOUD_TASKS_ENABLED") or "false").strip().lower() == "true"


def _service_url() -> str:
    return (os.getenv("SERVICE_URL") or "").rstrip("/")


def _run_local(handler_path: str, payload: dict[str, Any]) -> None:
    """Run a registered handler in-process (best-effort; logs and swallows errors so
    a local background task can't crash the worker). Safe whether or not an event
    loop is already running in the current thread."""
    import asyncio

    fn = _LOCAL_HANDLERS.get(handler_path)
    if fn is None:
        logger.error("cloud_tasks local dispatch: no handler for %s", handler_path)
        return

    async def _guarded() -> None:
        try:
            await fn(payload)
        except Exception:
            logger.exception("cloud_tasks local handler failed: %s", handler_path)

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(_guarded())          # no loop in this thread — run to completion
    else:
        asyncio.ensure_future(_guarded())  # already in a loop — schedule concurrently


def enqueue(
    queue: str,
    handler_path: str,
    payload: dict[str, Any],
    *,
    delay_seconds: int = 0,
    background_tasks: Any | None = None,
) -> None:
    """Enqueue durable work.

    queue: Cloud Tasks queue name (prod). handler_path: the `/tasks/*` route.
    delay_seconds: schedule delay (Cloud Tasks schedule_time; best-effort locally).
    background_tasks: pass the endpoint's FastAPI BackgroundTasks so local dispatch
    runs after the response; omit in tests to run inline.
    """
    if not cloud_tasks_enabled():
        if background_tasks is not None and delay_seconds <= 0:
            background_tasks.add_task(_run_local, handler_path, payload)
        elif delay_seconds > 0:
            # Best-effort delayed dispatch for local dev (not durable).
            threading.Timer(delay_seconds, _run_local, args=(handler_path, payload)).start()
        else:
            _run_local(handler_path, payload)
        return

    service_url = _service_url()
    service_account = os.getenv("CLOUD_TASKS_SERVICE_ACCOUNT") or ""
    if not service_url or not service_account:
        logger.error(
            "CLOUD_TASKS_ENABLED but SERVICE_URL/CLOUD_TASKS_SERVICE_ACCOUNT unset; dropping task %s",
            handler_path,
        )
        return

    from google.cloud import tasks_v2

    project = os.getenv("GOOGLE_CLOUD_PROJECT") or ""
    location = os.getenv("CLOUD_TASKS_LOCATION") or "us-central1"
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(project, location, queue)
    task: dict[str, Any] = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": f"{service_url}{handler_path}",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(payload).encode(),
            "oidc_token": {
                "service_account_email": service_account,
                "audience": service_url,
            },
        }
    }
    if delay_seconds > 0:
        from datetime import datetime, timedelta, timezone
        from google.protobuf import timestamp_pb2

        ts = timestamp_pb2.Timestamp()
        ts.FromDatetime(datetime.now(timezone.utc) + timedelta(seconds=delay_seconds))
        task["schedule_time"] = ts

    client.create_task(parent=parent, task=task)
    logger.info("enqueued task queue=%s handler=%s delay=%ss", queue, handler_path, delay_seconds)


# Queue name constants (env-overridable so infra can rename without code changes).
QUEUE_ATTACHMENTS = os.getenv("CLOUD_TASKS_QUEUE_ATTACHMENTS") or "attachments"
QUEUE_RUNS = os.getenv("CLOUD_TASKS_QUEUE_RUNS") or "agent-runs"
QUEUE_INDEXING = os.getenv("CLOUD_TASKS_QUEUE_INDEXING") or "indexing"
