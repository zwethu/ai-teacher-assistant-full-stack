"""Agent Platform session-state helpers for deployed ADK Agent Engine apps."""

from __future__ import annotations

import logging
import os
from typing import Any

from google.adk.events import Event, EventActions
from google.adk.sessions import VertexAiSessionService

logger = logging.getLogger(__name__)

DEFAULT_AGENT_APP_NAME = "pnai-teacher-assistant"
SESSION_TTL_SECONDS = 90 * 24 * 60 * 60


def agent_engine_id_from_resource_name(resource_name: str) -> str:
    """Return the reasoning engine id from projects/.../reasoningEngines/{id}."""
    clean = resource_name.strip().rstrip("/")
    if clean.endswith(":streamQuery"):
        raise ValueError(
            "AGENT_ENGINE_RESOURCE_NAME must be the SDK resource name, not a :streamQuery URL."
        )
    if "/reasoningEngines/" not in clean:
        raise ValueError(f"Invalid Agent Engine resource name: {resource_name!r}")
    return clean.split("/")[-1]


def get_vertex_session_service(resource_name: str) -> VertexAiSessionService:
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    location = os.getenv("AGENT_ENGINE_LOCATION", "us-central1").strip()
    return VertexAiSessionService(
        project=project,
        location=location,
        agent_engine_id=agent_engine_id_from_resource_name(resource_name),
    )


async def ensure_session_with_state(
    resource_name: str,
    user_id: str,
    session_id: str,
    state: dict[str, Any],
) -> None:
    """Create/reuse a Vertex AI Agent Engine session and apply state_delta."""
    service = get_vertex_session_service(resource_name)
    app_name = _app_name()

    session = await _get_session(
        service=service,
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
    )
    if session is None:
        try:
            session = await service.create_session(
                app_name=app_name,
                user_id=user_id,
                session_id=session_id,
                state=state,
                ttl=f"{SESSION_TTL_SECONDS}s",
            )
            logger.info(
                "Agent Platform session created with state app=%s user_id=%s "
                "session_id=%s keys=%s",
                app_name,
                user_id,
                session_id,
                sorted(state.keys()),
            )
            return
        except Exception as exc:
            if not _is_already_exists_error(exc):
                logger.exception(
                    "Agent Platform create_session failed app=%s user_id=%s session_id=%s",
                    app_name,
                    user_id,
                    session_id,
                )
                raise
            logger.info(
                "Agent Platform create_session reported already exists; appending state "
                "app=%s user_id=%s session_id=%s: %s",
                app_name,
                user_id,
                session_id,
                exc,
            )
            session = await service.get_session(
                app_name=app_name,
                user_id=user_id,
                session_id=session_id,
            )
            if session is None:
                raise RuntimeError(
                    "Agent Platform session already existed but could not be fetched"
                ) from exc

    event = Event(
        author="pnai-backend",
        invocation_id=str(state.get("run_id") or ""),
        actions=EventActions(state_delta=state),
    )
    await service.append_event(session=session, event=event)
    updated_session = await service.get_session(
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
    )
    updated_keys = sorted((updated_session.state if updated_session else {}).keys())
    logger.info(
        "Agent Platform session state applied app=%s user_id=%s session_id=%s keys=%s",
        app_name,
        user_id,
        session_id,
        updated_keys,
    )


async def _get_session(
    *,
    service: VertexAiSessionService,
    app_name: str,
    user_id: str,
    session_id: str,
):
    try:
        session = await service.get_session(
            app_name=app_name,
            user_id=user_id,
            session_id=session_id,
        )
    except Exception:
        logger.exception(
            "Agent Platform get_session failed app=%s user_id=%s session_id=%s",
            app_name,
            user_id,
            session_id,
        )
        raise
    if session is None:
        logger.info(
            "Agent Platform session not found app=%s user_id=%s session_id=%s",
            app_name,
            user_id,
            session_id,
        )
    return session


def _app_name() -> str:
    return os.getenv("AGENT_APP_NAME", DEFAULT_AGENT_APP_NAME).strip() or DEFAULT_AGENT_APP_NAME


def _is_already_exists_error(exc: Exception) -> bool:
    text = f"{exc.__class__.__name__} {exc}".lower()
    compact = text.replace(" ", "").replace("_", "").replace("-", "")
    return (
        "already exists" in text
        or "already_exists" in text
        or "alreadyexists" in compact
        or "409" in text
    )
