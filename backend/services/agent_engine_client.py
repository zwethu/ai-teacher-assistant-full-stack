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

Trusted run/batch state is managed through Agent Platform Sessions, not
async_stream_query(state=...).  AGENT_APP_NAME defaults to
pnai-teacher-assistant for session service calls.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

from services.agent_platform_sessions import ensure_session_with_state

# Quota/availability blips worth retrying. 429 RESOURCE_EXHAUSTED is the one
# observed in production (Gemini quota); the 5xx family covers engine restarts.
_TRANSIENT_ERROR_MARKERS = (
    "429",
    "resource_exhausted",
    "resource exhausted",
    "quota",
    "503",
    "unavailable",
    "502",
    "504",
    "deadline_exceeded",
    "internal error encountered",
)
_STREAM_START_ATTEMPTS = 3
_STREAM_RETRY_DELAYS_S = (2.0, 8.0)


def is_transient_engine_error(exc: Exception) -> bool:
    """True for quota/availability failures that a short backoff can outlive."""
    text = str(exc).lower()
    return any(marker in text for marker in _TRANSIENT_ERROR_MARKERS)

logger = logging.getLogger(__name__)

_LOCATION: str = os.getenv("AGENT_ENGINE_LOCATION", "us-central1").strip()
_PROJECT: str = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
_DEBUG_STREAM_TEXT: bool = os.getenv("PNAI_DEBUG_AGENT_STREAM_TEXT", "").strip().lower() in {
    "1",
    "true",
    "yes",
}
_INTERNAL_TEXT_PREFIXES = (
    "thought:",
    "thinking:",
    "<thought>",
    "model_thinking",
)
_INTERNAL_MARKERS = ("thought", "thinking", "reasoning", "internal", "model_thinking")
_TOOL_FIELDS = ("function_call", "function_response", "tool_call", "tool_response")
_PUBLIC_RESPONSE_AUTHOR = "pnai_root_agent"


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
    session_assume_exists: bool = False,
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
    #
    # Transient failures (429 quota, 5xx availability) are retried here ONLY
    # when the stream died before its first event — at that point the agent has
    # not executed anything, so a re-run has no side effects. Once events have
    # flowed, tools may have run (searches, sends), so a mid-run failure is not
    # re-run at this layer; the Gemini client inside the agent retries its own
    # HTTP calls instead (retry_options in pnai/shared/config.py).
    for attempt in range(1, _STREAM_START_ATTEMPTS + 1):
        progress: dict[str, bool] = {"saw_event": False}
        try:
            async for chunk in _sdk_stream(
                user_message=user_message,
                session_id=session_id,
                lecturer_id=lecturer_id,
                session_state=session_state,
                resource_name=resource_name,
                session_assume_exists=session_assume_exists,
                progress=progress,
            ):
                yield chunk
            return
        except Exception as exc:
            retryable = (
                not progress["saw_event"]
                and attempt < _STREAM_START_ATTEMPTS
                and is_transient_engine_error(exc)
            )
            if not retryable:
                raise
            delay = _STREAM_RETRY_DELAYS_S[attempt - 1]
            logger.warning(
                "event=stream_start_retry attempt=%d delay_s=%.0f session_id=%s "
                "error=%.200s",
                attempt,
                delay,
                session_id,
                str(exc),
            )
            await asyncio.sleep(delay)


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
        await ensure_session_with_state(resource_name, lecturer_id, session_id, {})
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
    session_assume_exists: bool = False,
    progress: dict[str, bool] | None = None,
) -> AsyncIterator[str]:
    """Real Agent Engine streaming call using google-cloud-aiplatform SDK."""
    # --- Import guard: only import SDK when we actually call it ---
    try:
        import vertexai
    except ImportError as exc:
        raise RuntimeError(
            "google-cloud-aiplatform[adk,agent-engines] is required for Agent Engine calls. "
            f"Install it and set AGENT_ENGINE_RESOURCE_NAME. Original error: {exc}"
        ) from exc

    span_start = time.perf_counter()
    agent = _get_agent(vertexai, resource_name)
    logger.info(
        "event=engine_get duration_ms=%d resource=%s",
        int((time.perf_counter() - span_start) * 1000),
        resource_name,
    )

    await ensure_session_with_state(
        resource_name=resource_name,
        user_id=lecturer_id,
        session_id=session_id,
        state=session_state,
        assume_exists=session_assume_exists,
    )
    logger.info(
        "Agent Platform session state applied before stream resource=%s user_id=%s "
        "session_id=%s state_keys=%s",
        resource_name,
        lecturer_id,
        session_id,
        sorted(session_state.keys()),
    )

    # Stream the response. State is deliberately not passed here; deployed ADK
    # templates call Runner.run_async(), which accepts session-backed state but
    # not an async_stream_query state kwarg.
    # The agent writes nested RTDB events directly during this call via telemetry.py.
    stream_kwargs = {
        "user_id": lecturer_id,
        "session_id": session_id,
        "message": user_message,
        # ADK defaults to StreamingMode.NONE even when Agent Engine is queried
        # through streamQuery. SSE makes the schema-free root presenter emit
        # native partial events; nested PNAI runners explicitly remain atomic.
        "run_config": {"streaming_mode": "sse"},
    }
    logger.info(
        "Agent Engine async_stream_query start resource=%s user_id=%s session_id=%s "
        "streaming_mode=sse public_author=%s",
        resource_name,
        lecturer_id,
        session_id,
        _PUBLIC_RESPONSE_AUTHOR,
    )
    try:
        stream = agent.async_stream_query(**stream_kwargs)  # type: ignore[attr-defined]
    except TypeError as exc:
        logger.exception(
            "Agent Engine async_stream_query rejected documented args for "
            "resource=%s user_id=%s session_id=%s",
            resource_name,
            lecturer_id,
            session_id,
        )
        raise RuntimeError(
            "Agent Engine async_stream_query rejected documented user_id/session_id/message args"
        ) from exc
    except Exception:
        logger.exception(
            "Agent Engine async_stream_query failed before streaming resource=%s "
            "user_id=%s session_id=%s",
            resource_name,
            lecturer_id,
            session_id,
        )
        raise

    try:
        event_count = 0
        final_chunk_count = 0
        root_partial_count = 0
        aggregate_skip_count = 0
        saw_native_partial = False
        last_event_summary = ""
        stream_start = time.perf_counter()
        first_event_ms: int | None = None
        async for event in stream:
            if first_event_ms is None:
                first_event_ms = int((time.perf_counter() - stream_start) * 1000)
                logger.info(
                    "event=stream_first_event duration_ms=%d session_id=%s",
                    first_event_ms,
                    session_id,
                )
                if progress is not None:
                    # The agent is now executing: from here a re-run could
                    # repeat tool side effects, so the caller must not retry.
                    progress["saw_event"] = True
            event_count += 1
            last_event_summary = _event_summary(event)
            event_kind = _event_kind(event)
            author = _event_author(event)
            is_partial = _event_is_partial(event)
            is_root_presenter = author == _PUBLIC_RESPONSE_AUTHOR
            chunk = _event_text(event) if is_root_presenter else ""
            logger.debug(
                "Agent Engine stream event resource=%s user_id=%s session_id=%s "
                "event_index=%d author=%s partial=%s event_kind=%s "
                "root_presenter=%s chunk_length=%d fields=%s",
                resource_name,
                lecturer_id,
                session_id,
                event_count - 1,
                author,
                is_partial,
                event_kind,
                is_root_presenter,
                len(chunk),
                _event_fields(event),
            )
            error = _event_error(event)
            if error:
                raise RuntimeError(f"Agent Engine returned an error event: {error}")
            if not is_root_presenter:
                continue
            if chunk:
                if not is_partial and saw_native_partial:
                    aggregate_skip_count += 1
                    logger.debug(
                        "Agent Engine root chunk skipped event_id=%s reason=aggregate_after_partials "
                        "chunk_length=%d aggregate_skip_index=%d",
                        _event_id(event),
                        len(chunk),
                        aggregate_skip_count - 1,
                    )
                    continue
                if is_partial:
                    root_partial_count += 1
                saw_native_partial = saw_native_partial or is_partial
                emitted_index = final_chunk_count
                final_chunk_count += 1
                logger.debug(
                    "Agent Engine root chunk emitted event_id=%s partial=%s "
                    "chunk_index=%d chunk_length=%d",
                    _event_id(event),
                    is_partial,
                    emitted_index,
                    len(chunk),
                )
                if _DEBUG_STREAM_TEXT:
                    logger.debug("Agent Engine final text chunk: %r", chunk)
                yield chunk
        logger.info(
            "Agent Engine native stream summary resource=%s user_id=%s session_id=%s "
            "events=%d root_partials=%d emitted_chunks=%d aggregate_skips=%d "
            "native_multi_chunk=%s event=stream_total duration_ms=%d first_event_ms=%s",
            resource_name,
            lecturer_id,
            session_id,
            event_count,
            root_partial_count,
            final_chunk_count,
            aggregate_skip_count,
            root_partial_count > 1,
            int((time.perf_counter() - stream_start) * 1000),
            first_event_ms,
        )
        if event_count and not final_chunk_count:
            raise RuntimeError(
                "Agent Engine stream produced events but no assistant text. "
                f"Last event: {last_event_summary}"
            )
    except TypeError as exc:
        logger.exception(
            "Agent Engine async_stream_query stream failed with TypeError for "
            "resource=%s user_id=%s session_id=%s",
            resource_name,
            lecturer_id,
            session_id,
        )
        raise RuntimeError(
            "Agent Engine async_stream_query stream failed after session state was applied"
        ) from exc
    except Exception as exc:
        recovered_chunks = _recover_final_chunks_from_stream_exception(exc)
        if recovered_chunks:
            logger.warning(
                "Agent Engine SDK stream parser failed, recovered %d final text chunk(s) "
                "from raw response resource=%s user_id=%s session_id=%s error_type=%s",
                len(recovered_chunks),
                resource_name,
                lecturer_id,
                session_id,
                exc.__class__.__name__,
            )
            for chunk in recovered_chunks:
                yield chunk
            return

        logger.error(
            "Agent Engine async_stream_query stream failed resource=%s user_id=%s "
            "session_id=%s error_type=%s",
            resource_name,
            lecturer_id,
            session_id,
            exc.__class__.__name__,
        )
        raise


async def _create_or_get_session(
    *,
    session_id: str,
    lecturer_id: str,
    resource_name: str,
    agent: Any = None,
) -> None:
    """Create the Agent Platform session if it doesn't exist yet.

    This helper is intentionally idempotent. A get_session failure may be a
    not-found response, a transient SDK issue, or an API shape mismatch; if the
    subsequent create reports that the session already exists, that is a
    successful outcome for the caller.
    """
    if agent is None:
        import vertexai
        agent = _get_agent(vertexai, resource_name)

    try:
        await agent.async_get_session(  # type: ignore[attr-defined]
            user_id=lecturer_id,
            session_id=session_id,
        )
        logger.debug("Agent Engine session exists user_id=%s session_id=%s", lecturer_id, session_id)
        return
    except Exception as get_exc:
        if _is_not_found_error(get_exc):
            logger.info(
                "Agent Engine session not found; creating user_id=%s session_id=%s",
                lecturer_id,
                session_id,
            )
        else:
            logger.warning(
                "Agent Engine get_session failed; attempting create user_id=%s session_id=%s: %s",
                lecturer_id,
                session_id,
                get_exc,
            )

    try:
        await agent.async_create_session(  # type: ignore[attr-defined]
            user_id=lecturer_id,
            session_id=session_id,
        )
        logger.info("Agent Engine session created user_id=%s session_id=%s", lecturer_id, session_id)
    except Exception as create_exc:
        if _is_already_exists_error(create_exc):
            logger.info(
                "Agent Engine create_session reported already exists; continuing "
                "user_id=%s session_id=%s: %s",
                lecturer_id,
                session_id,
                create_exc,
            )
            return
        logger.exception(
            "Agent Engine create_session failed user_id=%s session_id=%s",
            lecturer_id,
            session_id,
        )
        raise


# Engine handles are stable per resource; the uncached agent_engines.get() was a
# measured ~2.3s network round-trip on every run.
_AGENT_CACHE: dict[str, Any] = {}


def _get_agent(vertexai_module: Any, resource_name: str) -> Any:
    """Get an Agent Engine handle with the current SDK, falling back to preview."""
    cached = _AGENT_CACHE.get(resource_name)
    if cached is not None:
        return cached
    client_cls = getattr(vertexai_module, "Client", None)
    if client_cls is not None:
        try:
            client = client_cls(project=_PROJECT, location=_LOCATION)
            agent = client.agent_engines.get(name=resource_name)
            _AGENT_CACHE[resource_name] = agent
            return agent
        except AttributeError:
            logger.info("vertexai.Client agent_engines API unavailable; using preview fallback")

    from vertexai.preview import reasoning_engines  # type: ignore[import]

    vertexai_module.init(project=_PROJECT, location=_LOCATION)
    agent = reasoning_engines.ReasoningEngine(resource_name)
    _AGENT_CACHE[resource_name] = agent
    return agent


def _event_text(event: Any) -> str:
    if _event_kind(event) != "final_text":
        return ""

    if isinstance(event, dict):
        text = _part_text_for_final(event)
        if text:
            return str(text)
        return _content_text(event.get("content"))
    text = _part_text_for_final(event)
    if text:
        return text
    return _content_text(getattr(event, "content", None))


def _event_author(event: Any) -> str:
    return str(_get_value(event, "author") or "")


def _event_id(event: Any) -> str:
    return str(_get_value(event, "id") or "")


def _event_is_partial(event: Any) -> bool:
    return _truthy(_get_value(event, "partial"))


def _content_text(content: Any) -> str:
    if not content:
        return ""
    if isinstance(content, str):
        return "" if _text_has_internal_prefix(content) else content
    if isinstance(content, dict):
        direct_text = _part_text_for_final(content)
        if direct_text:
            return direct_text
        parts = content.get("parts") or []
    else:
        direct_text = _part_text_for_final(content)
        if direct_text:
            return direct_text
        parts = getattr(content, "parts", None) or []

    texts: list[str] = []
    for part in parts:
        text = _part_text_for_final(part)
        if text:
            texts.append(text)
    return "".join(texts)


def _event_kind(event: Any) -> str:
    error = _event_error(event)
    if error:
        return "error"
    if _has_internal_marker(event) or _event_level_thought(event):
        return "thinking"
    if _event_has_tool_or_function_part(event):
        return "tool"
    if _event_has_final_text(event):
        return "final_text"
    return "internal"


def _event_has_final_text(event: Any) -> bool:
    if _part_text_for_final(event):
        return True
    content = _get_value(event, "content")
    return bool(_content_text(content))


def _event_has_tool_or_function_part(event: Any) -> bool:
    if _is_tool_or_function_part(event):
        return True
    content = _get_value(event, "content")
    parts = _get_value(content, "parts") if content is not None else None
    if parts:
        return any(_is_tool_or_function_part(part) for part in parts)
    return _is_tool_or_function_part(content)


def _event_level_thought(event: Any) -> bool:
    if _truthy(_get_value(event, "thought")):
        return True
    content = _get_value(event, "content")
    return _is_thought_part(content)


def _part_text_for_final(part: Any) -> str:
    if not part or _is_thought_part(part) or _is_tool_or_function_part(part):
        return ""
    text = _get_value(part, "text")
    if not text:
        return ""
    text = str(text)
    if _text_has_internal_prefix(text):
        return ""
    return text


def _is_thought_part(part: Any) -> bool:
    if not part:
        return False
    if _truthy(_get_value(part, "thought")):
        return True
    if _has_internal_marker(part):
        return True
    text = _get_value(part, "text")
    return bool(text and _text_has_internal_prefix(str(text)))


def _is_tool_or_function_part(part: Any) -> bool:
    if not part:
        return False
    return any(_get_value(part, field) is not None for field in _TOOL_FIELDS)


def _has_internal_marker(value: Any) -> bool:
    candidates: list[str] = []
    for key in ("role", "kind", "type", "category"):
        item = _get_value(value, key)
        if item is not None:
            candidates.append(str(item))
    metadata = _get_value(value, "metadata")
    if metadata:
        for key in ("role", "kind", "type", "category"):
            item = _get_value(metadata, key)
            if item is not None:
                candidates.append(str(item))
    joined = " ".join(candidates).lower()
    return any(marker in joined for marker in _INTERNAL_MARKERS)


def _text_has_internal_prefix(text: str) -> bool:
    stripped = text.lstrip().lower()
    return any(stripped.startswith(prefix) for prefix in _INTERNAL_TEXT_PREFIXES)


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes"}
    return bool(value)


def _get_value(value: Any, key: str) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


def _event_error(event: Any) -> str:
    if isinstance(event, dict):
        for key in ("error", "error_message", "exception"):
            value = event.get(key)
            if value:
                return _short_repr(value)
        code = event.get("code")
        message = event.get("message")
        if code or message:
            return f"{code or 'UNKNOWN'}: {message or ''}".strip()
    for key in ("error", "error_message", "exception"):
        value = getattr(event, key, None)
        if value:
            return _short_repr(value)
    code = getattr(event, "code", None)
    message = getattr(event, "message", None)
    if code or message:
        return f"{code or 'UNKNOWN'}: {message or ''}".strip()
    return ""


def _event_summary(event: Any) -> str:
    return f"kind={_event_kind(event)} fields={_event_fields(event)}"


def _event_fields(event: Any) -> list[str]:
    if isinstance(event, dict):
        return sorted(str(key) for key in event.keys())
    try:
        return sorted(
            key for key in vars(event).keys() if not key.startswith("_")
        )
    except TypeError:
        return [event.__class__.__name__]


def _recover_final_chunks_from_stream_exception(exc: Exception) -> list[str]:
    """Recover final text when the SDK exposes concatenated JSON in an error.

    Some SDK versions raise UnknownApiResponseError when the stream segment
    contains multiple JSON objects back-to-back. The raw text can include tool
    responses, thought parts, and thought signatures, so this function never
    logs or returns the raw response. It parses objects and reuses _event_text().
    """
    raw = _extract_raw_response_from_exception(exc)
    if not raw:
        return []

    partial_chunks: list[str] = []
    complete_chunks: list[str] = []
    decoder = json.JSONDecoder()
    index = 0
    while index < len(raw):
        while index < len(raw) and raw[index].isspace():
            index += 1
        if index >= len(raw):
            break
        try:
            event, next_index = decoder.raw_decode(raw, index)
        except json.JSONDecodeError:
            return partial_chunks or complete_chunks
        if _event_author(event) != _PUBLIC_RESPONSE_AUTHOR:
            index = next_index
            continue
        text = _event_text(event)
        if text:
            if _event_is_partial(event):
                partial_chunks.append(text)
            else:
                complete_chunks.append(text)
        index = next_index
    return partial_chunks or complete_chunks


def _extract_raw_response_from_exception(exc: Exception) -> str:
    text = str(exc)
    marker = "Raw response:"
    if marker not in text:
        return ""
    return text.split(marker, 1)[1].strip()


def _short_repr(value: Any, limit: int = 1000) -> str:
    text = repr(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


def _is_already_exists_error(exc: Exception) -> bool:
    return _error_matches(
        exc,
        codes={"ALREADY_EXISTS", "already_exists", "409"},
        phrases={"already exists", "alreadyexists", "already_exists"},
    )


def _is_not_found_error(exc: Exception) -> bool:
    return _error_matches(
        exc,
        codes={"NOT_FOUND", "not_found", "404"},
        phrases={"not found", "notfound", "not_found", "does not exist"},
    )


def _error_matches(exc: Exception, *, codes: set[str], phrases: set[str]) -> bool:
    candidates: list[str] = [
        str(exc),
        exc.__class__.__name__,
    ]
    for attr in ("code", "status", "reason"):
        value = getattr(exc, attr, None)
        if value is None:
            continue
        try:
            value = value() if callable(value) else value
        except TypeError:
            pass
        candidates.append(str(value))

    joined = " ".join(candidates)
    normalized = joined.lower().replace("-", "_")
    compact = normalized.replace(" ", "").replace("_", "")
    return any(code.lower() in normalized for code in codes) or any(
        phrase in normalized or phrase.replace(" ", "").replace("_", "") in compact
        for phrase in phrases
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
