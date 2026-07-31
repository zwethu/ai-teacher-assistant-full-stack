"""Tests for the slimmed Agent Platform session path (Tier-1 latency work).

Covers: assume_exists direct-append (1 RPC, no get_session), not-found fallback
to create, state-only GetSessionConfig on every fetch, and service caching.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

import services.agent_platform_sessions as aps

RESOURCE = "projects/p/locations/us-central1/reasoningEngines/123"


@pytest.fixture(autouse=True)
def _clear_service_cache():
    aps._SERVICE_CACHE.clear()
    yield
    aps._SERVICE_CACHE.clear()


def _mock_service():
    service = MagicMock()
    service.get_session = AsyncMock(return_value=None)
    service.create_session = AsyncMock()
    service.append_event = AsyncMock()
    return service


def test_state_only_config_skips_event_history():
    assert aps._STATE_ONLY.num_recent_events == 0


def test_service_is_cached_per_resource(monkeypatch):
    made = []

    def fake_ctor(**kwargs):
        made.append(kwargs)
        return MagicMock()

    monkeypatch.setattr(aps, "VertexAiSessionService", fake_ctor)
    first = aps.get_vertex_session_service(RESOURCE)
    second = aps.get_vertex_session_service(RESOURCE)
    assert first is second
    assert len(made) == 1
    assert made[0]["agent_engine_id"] == "123"


def test_assume_exists_appends_directly_without_get(monkeypatch):
    service = _mock_service()
    monkeypatch.setattr(aps, "get_vertex_session_service", lambda _rn: service)

    asyncio.run(
        aps.ensure_session_with_state(
            resource_name=RESOURCE,
            user_id="lecturer-1",
            session_id="chat-session-1",
            state={"run_id": "run-1", "batch_id": "b1"},
            assume_exists=True,
        )
    )

    service.get_session.assert_not_awaited()
    service.create_session.assert_not_awaited()
    assert service.append_event.await_count == 1
    kwargs = service.append_event.await_args.kwargs
    assert kwargs["session"].id == "chat-session-1"
    assert kwargs["event"].actions.state_delta == {"run_id": "run-1", "batch_id": "b1"}
    assert kwargs["event"].invocation_id == "run-1"


def test_assume_exists_falls_back_to_create_on_not_found(monkeypatch):
    service = _mock_service()
    service.append_event = AsyncMock(side_effect=RuntimeError("404 session NOT_FOUND"))
    monkeypatch.setattr(aps, "get_vertex_session_service", lambda _rn: service)

    asyncio.run(
        aps.ensure_session_with_state(
            resource_name=RESOURCE,
            user_id="lecturer-1",
            session_id="chat-session-1",
            state={"run_id": "run-1"},
            assume_exists=True,
        )
    )

    # Fallback path: one existence check, then create carries the state.
    assert service.get_session.await_count == 1
    assert service.create_session.await_count == 1
    create_kwargs = service.create_session.await_args.kwargs
    assert create_kwargs["state"] == {"run_id": "run-1"}


def test_assume_exists_reraises_non_notfound_errors(monkeypatch):
    service = _mock_service()
    service.append_event = AsyncMock(side_effect=RuntimeError("503 backend unavailable"))
    monkeypatch.setattr(aps, "get_vertex_session_service", lambda _rn: service)

    with pytest.raises(RuntimeError, match="503"):
        asyncio.run(
            aps.ensure_session_with_state(
                resource_name=RESOURCE,
                user_id="lecturer-1",
                session_id="chat-session-1",
                state={"run_id": "run-1"},
                assume_exists=True,
            )
        )
    service.create_session.assert_not_awaited()


def test_new_session_path_creates_with_state(monkeypatch):
    service = _mock_service()
    monkeypatch.setattr(aps, "get_vertex_session_service", lambda _rn: service)

    asyncio.run(
        aps.ensure_session_with_state(
            resource_name=RESOURCE,
            user_id="lecturer-1",
            session_id="chat-session-1",
            state={"run_id": "run-1"},
        )
    )

    assert service.get_session.await_count == 1
    assert service.get_session.await_args.kwargs["config"] is aps._STATE_ONLY
    assert service.create_session.await_count == 1
    service.append_event.assert_not_awaited()


def test_get_agent_session_state_uses_state_only_config(monkeypatch):
    service = _mock_service()
    session = MagicMock()
    session.state = {"lesson_plan_outline": {"title": "T"}}
    service.get_session = AsyncMock(return_value=session)
    monkeypatch.setattr(aps, "get_vertex_session_service", lambda _rn: service)

    state = asyncio.run(
        aps.get_agent_session_state(
            resource_name=RESOURCE, user_id="lecturer-1", session_id="chat-session-1"
        )
    )

    assert state == {"lesson_plan_outline": {"title": "T"}}
    assert service.get_session.await_args.kwargs["config"] is aps._STATE_ONLY


def test_not_found_matcher():
    assert aps._is_not_found_error(RuntimeError("404 NOT_FOUND"))
    assert aps._is_not_found_error(RuntimeError("Session does not exist"))
    assert not aps._is_not_found_error(RuntimeError("409 already exists"))
