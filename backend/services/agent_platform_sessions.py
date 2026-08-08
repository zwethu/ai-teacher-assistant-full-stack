"""Agent Platform session-state helpers for deployed ADK Agent Engine apps."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

from google.adk.events import Event, EventActions
from google.adk.sessions import Session, VertexAiSessionService
from google.adk.sessions.base_session_service import GetSessionConfig

logger = logging.getLogger(__name__)

DEFAULT_AGENT_APP_NAME = "pnai-teacher-assistant"
SESSION_TTL_SECONDS = 90 * 24 * 60 * 60

# Skip the events.list RPC entirely on session fetches — every caller here needs
# only session.state (and existence), never the event history, which grows with
# chat length and was downloaded in full on every run.
_STATE_ONLY = GetSessionConfig(num_recent_events=0)

# VertexAiSessionService is stateless config (project/location/engine id); cache
# one instance per resource name instead of rebuilding it on every call.
_SERVICE_CACHE: dict[str, VertexAiSessionService] = {}


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
    cached = _SERVICE_CACHE.get(resource_name)
    if cached is not None:
        return cached
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    location = os.getenv("AGENT_ENGINE_LOCATION", "us-central1").strip()
    service = VertexAiSessionService(
        project=project,
        location=location,
        agent_engine_id=agent_engine_id_from_resource_name(resource_name),
    )
    _SERVICE_CACHE[resource_name] = service
    return service


async def ensure_session_with_state(
    resource_name: str,
    user_id: str,
    session_id: str,
    state: dict[str, Any],
    assume_exists: bool = False,
) -> None:
    """Create/reuse a Vertex AI Agent Engine session and apply state_delta.

    With assume_exists=True (chat doc already recorded this session id), skip the
    existence-check get_session and append the state delta directly — append_event
    only needs app/user/session ids, not a fetched Session. Falls back to the full
    create/append path if the append fails because the session is missing.
    """
    started = time.perf_counter()
    service = get_vertex_session_service(resource_name)
    app_name = _app_name()

    if assume_exists:
        session = _local_session(app_name=app_name, user_id=user_id, session_id=session_id)
        try:
            await _append_state(service=service, session=session, state=state)
            logger.info(
                "event=ensure_session duration_ms=%s path=append_direct session_id=%s keys=%s",
                _ms(started),
                session_id,
                sorted(state.keys()),
            )
            return
        except Exception as exc:
            if not _is_not_found_error(exc):
                raise
            logger.warning(
                "Agent Platform direct append found no session; falling back to create "
                "session_id=%s: %s",
                session_id,
                exc,
            )
            # The chat doc says this session existed, but Vertex no longer has it —
            # almost always the 90-day TTL. The recreated session is empty, so
            # earlier outlines/artifacts in agent memory are gone. Surface that.
            _emit_session_expired_event(state)

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
                "event=ensure_session duration_ms=%s path=created session_id=%s keys=%s",
                _ms(started),
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
                config=_STATE_ONLY,
            )
            if session is None:
                raise RuntimeError(
                    "Agent Platform session already existed but could not be fetched"
                ) from exc

    await _append_state(service=service, session=session, state=state)
    logger.info(
        "event=ensure_session duration_ms=%s path=fetched_append session_id=%s keys=%s",
        _ms(started),
        session_id,
        sorted(state.keys()),
    )


async def get_agent_session_state(
    resource_name: str,
    user_id: str,
    session_id: str,
) -> dict[str, Any]:
    """Fetch Agent Platform session state without logging sensitive values."""
    started = time.perf_counter()
    service = get_vertex_session_service(resource_name)
    app_name = _app_name()
    session = await service.get_session(
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
        config=_STATE_ONLY,
    )
    state = dict(session.state or {}) if session else {}
    logger.info(
        "event=get_session_state duration_ms=%s app=%s user_id=%s session_id=%s keys=%s",
        _ms(started),
        app_name,
        user_id,
        session_id,
        sorted(state.keys()),
    )
    return state


async def _append_state(
    *,
    service: VertexAiSessionService,
    session: Session,
    state: dict[str, Any],
) -> None:
    event = Event(
        author="mila-backend",
        invocation_id=str(state.get("run_id") or ""),
        actions=EventActions(state_delta=state),
    )
    await service.append_event(session=session, event=event)


def _emit_session_expired_event(state: dict[str, Any]) -> None:
    """Best-effort run event when a supposedly-existing session had expired."""
    run_id = str(state.get("run_id") or "")
    if not run_id:
        return
    try:
        from utils.rtdb_client import write_run_event

        write_run_event(
            run_id,
            event_type="backend.session.expired",
            kind="thinking",
            status="running",
            title="Starting a fresh session — earlier conversation context has expired.",
            summary="Starting a fresh session — earlier conversation context has expired.",
            detail={"mode": "status"},
            batch_id=str(state.get("batch_id") or ""),
            chat_id=str(state.get("chat_id") or ""),
        )
    except Exception:
        logger.warning("failed to emit session-expired event", exc_info=True)


def _local_session(*, app_name: str, user_id: str, session_id: str) -> Session:
    """Session shell for append_event — the remote call uses only the ids."""
    return Session(
        app_name=app_name,
        user_id=user_id,
        id=session_id,
        state={},
        events=[],
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
            config=_STATE_ONLY,
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


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _is_already_exists_error(exc: Exception) -> bool:
    text = f"{exc.__class__.__name__} {exc}".lower()
    compact = text.replace(" ", "").replace("_", "").replace("-", "")
    return (
        "already exists" in text
        or "already_exists" in text
        or "alreadyexists" in compact
        or "409" in text
    )


def _is_not_found_error(exc: Exception) -> bool:
    text = f"{exc.__class__.__name__} {exc}".lower()
    compact = text.replace(" ", "").replace("_", "").replace("-", "")
    return "notfound" in compact or "404" in text or "does not exist" in text
