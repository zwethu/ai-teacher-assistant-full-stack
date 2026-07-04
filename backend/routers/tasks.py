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
    await asyncio.to_thread(
        process_chat_attachment,
        str(payload["batch_id"]), str(payload["chat_id"]), str(payload["attachment_id"]),
    )


@router.post("/process-attachment", status_code=status.HTTP_204_NO_CONTENT)
async def process_attachment_task(request: Request, _: None = Depends(verify_task_caller)) -> None:
    payload = await request.json()
    await _handle_process_attachment(payload)


register_local_handler("/tasks/process-attachment", _handle_process_attachment)
