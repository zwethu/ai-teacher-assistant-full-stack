"""Transient engine failures retry before the agent runs — never after."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import services.agent_engine_client as client


def _collect(gen):
    async def run():
        chunks = []
        async for chunk in gen:
            chunks.append(chunk)
        return chunks

    return asyncio.run(run())


def _stream(monkeypatch_target_outcomes):
    """Build a fake _sdk_stream: each call pops an outcome list entry.

    An outcome is either a list of (chunks, saw_event) → success, or an
    Exception raised after optionally marking saw_event.
    """
    calls = {"count": 0}

    async def fake_sdk_stream(*, progress=None, **kwargs):
        outcome = monkeypatch_target_outcomes[calls["count"]]
        calls["count"] += 1
        if isinstance(outcome, Exception):
            if getattr(outcome, "saw_event", False) and progress is not None:
                progress["saw_event"] = True
            raise outcome
        if progress is not None:
            progress["saw_event"] = True
        for chunk in outcome:
            yield chunk

    return fake_sdk_stream, calls


def _run_stream():
    return client.stream_agent_response(
        user_message="hi",
        session_id="s1",
        lecturer_id="u1",
        session_state={},
    )


def test_pre_event_429_is_retried(monkeypatch):
    monkeypatch.setenv("AGENT_ENGINE_RESOURCE_NAME", "projects/p/locations/l/reasoningEngines/1")
    err = RuntimeError("429 RESOURCE_EXHAUSTED quota")
    fake, calls = _stream([err, ["hello"]])
    with patch.object(client, "_sdk_stream", fake), patch.object(asyncio, "sleep", _no_sleep):
        assert _collect(_run_stream()) == ["hello"]
    assert calls["count"] == 2


def test_mid_run_failure_is_not_retried(monkeypatch):
    """Once events flowed, tools may have run — a re-run could double side effects."""
    monkeypatch.setenv("AGENT_ENGINE_RESOURCE_NAME", "projects/p/locations/l/reasoningEngines/1")
    err = RuntimeError("Agent Engine returned an error event: 429 RESOURCE_EXHAUSTED")
    err.saw_event = True
    fake, calls = _stream([err, ["never"]])
    with patch.object(client, "_sdk_stream", fake), patch.object(asyncio, "sleep", _no_sleep):
        try:
            _collect(_run_stream())
            raise AssertionError("expected the mid-run error to propagate")
        except RuntimeError as exc:
            assert "429" in str(exc)
    assert calls["count"] == 1


def test_non_transient_error_is_not_retried(monkeypatch):
    monkeypatch.setenv("AGENT_ENGINE_RESOURCE_NAME", "projects/p/locations/l/reasoningEngines/1")
    err = RuntimeError("invalid argument: bad request shape")
    fake, calls = _stream([err])
    with patch.object(client, "_sdk_stream", fake), patch.object(asyncio, "sleep", _no_sleep):
        try:
            _collect(_run_stream())
            raise AssertionError("expected the error to propagate")
        except RuntimeError:
            pass
    assert calls["count"] == 1


def test_retries_are_bounded(monkeypatch):
    monkeypatch.setenv("AGENT_ENGINE_RESOURCE_NAME", "projects/p/locations/l/reasoningEngines/1")
    errors = [RuntimeError("503 unavailable") for _ in range(3)]
    fake, calls = _stream(errors)
    with patch.object(client, "_sdk_stream", fake), patch.object(asyncio, "sleep", _no_sleep):
        try:
            _collect(_run_stream())
            raise AssertionError("expected exhaustion to propagate")
        except RuntimeError:
            pass
    assert calls["count"] == 3


def test_transient_classifier():
    assert client.is_transient_engine_error(RuntimeError("429 RESOURCE_EXHAUSTED"))
    assert client.is_transient_engine_error(RuntimeError("503 Service Unavailable"))
    assert not client.is_transient_engine_error(RuntimeError("permission denied"))


def test_gateway_maps_quota_errors_to_friendly_text():
    from services.agent_gateway import safe_run_error_message

    msg = safe_run_error_message(
        RuntimeError("Agent Engine returned an error event: 429 RESOURCE_EXHAUSTED ...")
    )
    assert "capacity" in msg and "429" not in msg
    msg = safe_run_error_message(RuntimeError("503 UNAVAILABLE model overloaded"))
    assert "unavailable" in msg.lower() and "503" not in msg


async def _no_sleep(_delay):
    return None
