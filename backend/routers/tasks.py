"""Internal task-handler endpoints invoked by Cloud Tasks / Cloud Scheduler.

Not user-facing. Secured by OIDC (the caller signs a token with the tasks service
account; we verify audience + email). In local mode (CLOUD_TASKS_ENABLED off) the
handlers are invoked in-process, so auth is bypassed for loopback dispatch.

Every handler is idempotent — Cloud Tasks may deliver a task more than once.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from services.chat_attachment_service import process_chat_attachment
from services.cloud_tasks import cloud_tasks_enabled, register_local_handler

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["tasks"])


async def verify_task_caller(request: Request) -> None:
    """Verify the request came from Cloud Tasks/Scheduler via an OIDC token."""
    if not cloud_tasks_enabled():
        return  # local inline dispatch never hits the HTTP layer with a token
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = auth.split(" ", 1)[1]
    expected_sa = os.getenv("CLOUD_TASKS_SERVICE_ACCOUNT") or ""
    audience = (os.getenv("SERVICE_URL") or "").rstrip("/")
    try:
        from google.auth.transport import requests as ga_requests
        from google.oauth2 import id_token

        claims = id_token.verify_oauth2_token(token, ga_requests.Request(), audience=audience)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid OIDC token") from exc
    if expected_sa and claims.get("email") != expected_sa:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Untrusted task caller")


# ---------------------------------------------------------------------------
# Handlers (payload-dict functions, shared by the HTTP route and local dispatch)
# ---------------------------------------------------------------------------

async def _handle_process_attachment(payload: dict[str, Any]) -> None:
    from services.agent_gateway import on_attachment_settled

    batch_id, chat_id, attachment_id = (
        str(payload["batch_id"]), str(payload["chat_id"]), str(payload["attachment_id"]),
    )
    await asyncio.to_thread(process_chat_attachment, batch_id, chat_id, attachment_id)
    # If this attachment was the last one a deferred run was waiting on, dispatch it.
    await asyncio.to_thread(on_attachment_settled, batch_id, chat_id, attachment_id)


async def _handle_run_agent(payload: dict[str, Any]) -> None:
    from services.agent_gateway import run_agent_task

    await run_agent_task(str(payload["batch_id"]), str(payload["chat_id"]), str(payload["run_id"]))


async def _handle_attachment_watchdog(_payload: dict[str, Any]) -> None:
    from services.agent_gateway import run_attachment_watchdog

    await asyncio.to_thread(run_attachment_watchdog)


async def _handle_index_file(payload: dict[str, Any]) -> None:
    from services.file_service import run_index_file_task

    await asyncio.to_thread(
        run_index_file_task,
        str(payload["file_id"]), str(payload["batch_id"]), str(payload["gcs_path"]),
        str(payload["lecturer_id"]), str(payload["file_title"]),
        str(payload.get("course_name") or ""), str(payload.get("batch_name") or ""),
    )


async def _handle_check_indexing(payload: dict[str, Any]) -> None:
    from services.file_service import run_check_indexing_task

    await asyncio.to_thread(
        run_check_indexing_task,
        str(payload["file_id"]), str(payload["batch_id"]),
        str(payload["lecturer_id"]), int(payload.get("attempt") or 0),
    )


@router.post("/process-attachment", status_code=status.HTTP_204_NO_CONTENT)
async def process_attachment_task(request: Request, _: None = Depends(verify_task_caller)) -> None:
    await _handle_process_attachment(await request.json())


@router.post("/run-agent", status_code=status.HTTP_204_NO_CONTENT)
async def run_agent_endpoint(request: Request, _: None = Depends(verify_task_caller)) -> None:
    await _handle_run_agent(await request.json())


@router.post("/cron/attachment-watchdog", status_code=status.HTTP_204_NO_CONTENT)
async def attachment_watchdog_task(request: Request, _: None = Depends(verify_task_caller)) -> None:
    await _handle_attachment_watchdog({})


@router.post("/index-file", status_code=status.HTTP_204_NO_CONTENT)
async def index_file_task(request: Request, _: None = Depends(verify_task_caller)) -> None:
    await _handle_index_file(await request.json())


@router.post("/check-indexing", status_code=status.HTTP_204_NO_CONTENT)
async def check_indexing_task(request: Request, _: None = Depends(verify_task_caller)) -> None:
    await _handle_check_indexing(await request.json())


register_local_handler("/tasks/process-attachment", _handle_process_attachment)
register_local_handler("/tasks/run-agent", _handle_run_agent)
register_local_handler("/tasks/cron/attachment-watchdog", _handle_attachment_watchdog)
register_local_handler("/tasks/index-file", _handle_index_file)
register_local_handler("/tasks/check-indexing", _handle_check_indexing)
