"""Agent Engine SDK client — streaming call to the deployed PNAI ADK agent.

This module is intentionally kept thin.  It owns one concern: turn a session
state dict + user message into an async text stream from the deployed agent.

---- Deployment lifecycle ----

PHASE 1 (now) — Agent Engine not yet deployed.
  AGENT_ENGINE_RESOURCE_NAME is empty.  All calls return a placeholder string.
  The run lifecycle (meta, status, RTDB events) still works end-to-end so the
  frontend integration can be tested before deployment.

PHASE 2 — Agent Engine deployed.
  Set env vars:
    AGENT_ENGINE_RESOURCE_NAME=projects/.../locations/.../reasoningEngines/...
    AGENT_ENGINE_LOCATION=us-central1
    GOOGLE_CLOUD_PROJECT=...

  The SDK call uses async_stream_query from google-cloud-aiplatform[adk,agent-engines].

  Google's ADK + Agent Engine streaming pattern:
    import vertexai
    from vertexai.preview import reasoning_engines

    vertexai.init(project=PROJECT, location=LOCATION)
    agent = reasoning_engines.ReasoningEngine(AGENT_ENGINE_RESOURCE_NAME)

    async for event in agent.async_stream_query(
        user_id=lecturer_id,
        session_id=session_id,          # chat_id for resume
        message=user_message,
        state=session_state,            # trusted batch context + run telemetry keys
    ):
        text_chunk = event.get("text") or ""
        ...

---- Session management ----

Google's ADK session docs say:
  - Sessions are created per (app, user_id) and identified by session_id.
  - Custom session_id is supported.
  - Previous sessions can be resumed by providing session_id.
  - Default session TTL is 365 days.

For PNAI we use chat_id as session_id so conversation history is preserved
across runs. The session is created on the first message to a chat and reused
for every subsequent message in the same chat.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from typing import Any

logger = logging.getLogger(__name__)

_RESOURCE_NAME: str = os.getenv("AGENT_ENGINE_RESOURCE_NAME", "").strip()
_LOCATION: str = os.getenv("AGENT_ENGINE_LOCATION", "us-central1").strip()
_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def stream_agent_response(
    *,
    user_message: str,
    session_id: str,
    lecturer_id: str,
    session_state: dict[str, Any],
) -> AsyncIterator[str]:
    """Stream text chunks from the deployed Agent Engine.

    Yields str chunks.  The final full response is the concatenation of all
    chunks.  Callers should accumulate and save the final text.

    When Agent Engine is not yet deployed (AGENT_ENGINE_RESOURCE_NAME not set),
    yields a single placeholder chunk so the rest of the pipeline still works.
    """
    if not _RESOURCE_NAME:
        logger.info("Agent Engine not deployed — returning placeholder response")
        yield _placeholder(user_message)
        return

    # When AGENT_ENGINE_RESOURCE_NAME is set, let SDK exceptions bubble up.
    # _run_agent_background() already catches them and sets RTDB status=failed.
    # Silently swallowing errors would make a real deployment failure look like
    # a successful run with a placeholder message.
    async for chunk in _sdk_stream(
        user_message=user_message,
        session_id=session_id,
        lecturer_id=lecturer_id,
        session_state=session_state,
    ):
        yield chunk


async def ensure_session(
    *,
    session_id: str,
    lecturer_id: str,
) -> None:
    """Create an Agent Platform session for this chat if it does not exist.

    This is a no-op when Agent Engine is not yet deployed.
    Call once when a new chat is created so the session is ready before
    the first message.
    """
    if not _RESOURCE_NAME:
        return

    try:
        await _create_or_get_session(session_id=session_id, lecturer_id=lecturer_id)
    except Exception as exc:
        logger.warning("ensure_session failed for session_id=%s: %s", session_id, exc)


# ---------------------------------------------------------------------------
# SDK implementation (filled in once Agent Engine is deployed)
# ---------------------------------------------------------------------------

async def _sdk_stream(
    *,
    user_message: str,
    session_id: str,
    lecturer_id: str,
    session_state: dict[str, Any],
) -> AsyncIterator[str]:
    """Real Agent Engine streaming call using google-cloud-aiplatform SDK.

    TODO: Uncomment and test once AGENT_ENGINE_RESOURCE_NAME is set.
    """
    # --- Import guard: only import SDK when we actually call it ---
    try:
        import vertexai
        from vertexai.preview import reasoning_engines  # type: ignore[import]
    except ImportError as exc:
        raise RuntimeError(
            "google-cloud-aiplatform[adk,agent-engines] is required for Agent Engine calls. "
            f"Install it and set AGENT_ENGINE_RESOURCE_NAME. Original error: {exc}"
        ) from exc

    vertexai.init(project=_PROJECT, location=_LOCATION)
    agent = reasoning_engines.ReasoningEngine(_RESOURCE_NAME)

    # Ensure the session exists (creates it if this is the first message).
    await _create_or_get_session(session_id=session_id, lecturer_id=lecturer_id, agent=agent)

    # Stream the response.
    # The agent writes nested RTDB events directly during this call via telemetry.py.
    async for event in agent.async_stream_query(  # type: ignore[attr-defined]
        user_id=lecturer_id,
        session_id=session_id,
        message=user_message,
        state=session_state,
    ):
        chunk = str(event.get("text") or event.get("content") or "")
        if chunk:
            yield chunk


async def _create_or_get_session(
    *,
    session_id: str,
    lecturer_id: str,
    agent: Any = None,
) -> None:
    """Create the Agent Platform session if it doesn't exist yet."""
    if agent is None:
        import vertexai
        from vertexai.preview import reasoning_engines  # type: ignore[import]
        vertexai.init(project=_PROJECT, location=_LOCATION)
        agent = reasoning_engines.ReasoningEngine(_RESOURCE_NAME)

    try:
        await agent.async_get_session(  # type: ignore[attr-defined]
            user_id=lecturer_id,
            session_id=session_id,
        )
    except Exception:
        # Session doesn't exist — create it.
        await agent.async_create_session(  # type: ignore[attr-defined]
            user_id=lecturer_id,
            session_id=session_id,
        )


# ---------------------------------------------------------------------------
# Placeholder
# ---------------------------------------------------------------------------

def _placeholder(user_message: str) -> str:
    return (
        f"(Agent Engine not yet deployed)\n\n"
        f"Your message was received: {user_message!r}\n\n"
        f"The RTDB run lifecycle and telemetry event stream are fully operational. "
        f"Once AGENT_ENGINE_RESOURCE_NAME is set, this placeholder will be replaced "
        f"by the real agent response."
    )
