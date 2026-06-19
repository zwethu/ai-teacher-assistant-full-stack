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
        session_id=session_id,          # safe Agent Platform session id
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

For PNAI we use a sanitized agent_session_id derived from chat_id so
conversation history is preserved across runs without exposing raw Firestore
UUIDs to Agent Platform session ids.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

_LOCATION: str = os.getenv("AGENT_ENGINE_LOCATION", "us-central1").strip()
_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()


def get_agent_engine_resource_name() -> str:
    """Return the SDK resource name for the deployed Agent Engine."""
    resource_name = os.getenv("AGENT_ENGINE_RESOURCE_NAME", "").strip()
    if resource_name:
        if resource_name.endswith(":streamQuery"):
            raise ValueError(
                "AGENT_ENGINE_RESOURCE_NAME must be the SDK resource name, not the "
                "streamQuery REST URL or method path."
            )
        return resource_name

    url = os.getenv("AGENT_ENGINE_URL", "").strip()
    if not url:
        return ""
    return parse_resource_name_from_agent_engine_url(url)


def parse_resource_name_from_agent_engine_url(url: str) -> str:
    """Extract projects/.../reasoningEngines/... from a streamQuery REST URL."""
    parsed = urlparse(url)
    path = parsed.path.lstrip("/") if parsed.scheme else url.lstrip("/")
    marker = "projects/"
    marker_index = path.find(marker)
    if marker_index < 0:
        raise ValueError("AGENT_ENGINE_URL does not contain a projects/... resource path")

    resource_name = path[marker_index:]
    if resource_name.startswith("v1/"):
        resource_name = resource_name[3:]
    if resource_name.endswith(":streamQuery"):
        resource_name = resource_name[: -len(":streamQuery")]
    if not resource_name or resource_name.endswith(":streamQuery"):
        raise ValueError("Could not parse Agent Engine resource name from AGENT_ENGINE_URL")
    return resource_name


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
    resource_name = get_agent_engine_resource_name()
    if not resource_name:
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
        resource_name=resource_name,
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
    resource_name = get_agent_engine_resource_name()
    if not resource_name:
        return

    try:
        await _create_or_get_session(
            session_id=session_id,
            lecturer_id=lecturer_id,
            resource_name=resource_name,
        )
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
    resource_name: str,
) -> AsyncIterator[str]:
    """Real Agent Engine streaming call using google-cloud-aiplatform SDK.

    TODO: Uncomment and test once AGENT_ENGINE_RESOURCE_NAME is set.
    """
    # --- Import guard: only import SDK when we actually call it ---
    try:
        import vertexai
    except ImportError as exc:
        raise RuntimeError(
            "google-cloud-aiplatform[adk,agent-engines] is required for Agent Engine calls. "
            f"Install it and set AGENT_ENGINE_RESOURCE_NAME. Original error: {exc}"
        ) from exc

    agent = _get_agent(vertexai, resource_name)

    # Ensure the session exists (creates it if this is the first message).
    await _create_or_get_session(
        session_id=session_id,
        lecturer_id=lecturer_id,
        agent=agent,
        resource_name=resource_name,
    )

    # Stream the response.
    # The agent writes nested RTDB events directly during this call via telemetry.py.
    stream_kwargs = {
        "user_id": lecturer_id,
        "session_id": session_id,
        "message": user_message,
        "state": session_state,
    }
    try:
        stream = agent.async_stream_query(**stream_kwargs)  # type: ignore[attr-defined]
    except TypeError as exc:
        logger.exception(
            "Agent Engine async_stream_query rejected state/session args for "
            "resource=%s session_id=%s",
            resource_name,
            session_id,
        )
        raise RuntimeError(
            "Agent Engine async_stream_query rejected the trusted session_state payload"
        ) from exc

    async for event in stream:
        chunk = _event_text(event)
        if chunk:
            yield chunk


async def _create_or_get_session(
    *,
    session_id: str,
    lecturer_id: str,
    resource_name: str,
    agent: Any = None,
) -> None:
    """Create the Agent Platform session if it doesn't exist yet."""
    if agent is None:
        import vertexai
        agent = _get_agent(vertexai, resource_name)

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


def _get_agent(vertexai_module: Any, resource_name: str) -> Any:
    """Get an Agent Engine handle with the current SDK, falling back to preview."""
    client_cls = getattr(vertexai_module, "Client", None)
    if client_cls is not None:
        try:
            client = client_cls(project=_PROJECT, location=_LOCATION)
            return client.agent_engines.get(name=resource_name)
        except AttributeError:
            logger.info("vertexai.Client agent_engines API unavailable; using preview fallback")

    from vertexai.preview import reasoning_engines  # type: ignore[import]

    vertexai_module.init(project=_PROJECT, location=_LOCATION)
    return reasoning_engines.ReasoningEngine(resource_name)


def _event_text(event: Any) -> str:
    if isinstance(event, dict):
        return str(event.get("text") or event.get("content") or "")
    return str(getattr(event, "text", "") or getattr(event, "content", "") or "")


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
