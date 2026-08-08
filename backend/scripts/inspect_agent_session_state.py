"""Inspect or update Agent Platform session state for a deployed Agent Engine."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google.adk.events import Event, EventActions

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

from services.agent_engine_client import get_agent_engine_resource_name  # noqa: E402
from services.agent_platform_sessions import (  # noqa: E402
    DEFAULT_AGENT_APP_NAME,
    get_vertex_session_service,
)


async def main() -> None:
    _configure_relative_credentials()

    resource_name = get_agent_engine_resource_name()
    if not resource_name:
        raise SystemExit("Set AGENT_ENGINE_RESOURCE_NAME or AGENT_ENGINE_URL first.")

    app_name = os.getenv("AGENT_APP_NAME", DEFAULT_AGENT_APP_NAME).strip()
    user_id = os.getenv("TEST_AGENT_USER_ID", "").strip()
    session_id = os.getenv("TEST_AGENT_SESSION_ID", "").strip()
    if not user_id or not session_id:
        raise SystemExit("Set TEST_AGENT_USER_ID and TEST_AGENT_SESSION_ID.")

    print(f"project={os.getenv('GOOGLE_CLOUD_PROJECT', '').strip()}")
    print(f"location={os.getenv('AGENT_ENGINE_LOCATION', 'us-central1').strip()}")
    print(f"resource_name={resource_name}")
    print(f"app_name={app_name}")
    print(f"user_id={user_id}")
    print(f"session_id={session_id}")

    service = get_vertex_session_service(resource_name)
    session = await service.get_session(
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
    )
    if session is None:
        print("session not found")
        return

    _print_session("current", session)

    delta_json = os.getenv("TEST_STATE_DELTA_JSON", "").strip()
    if not delta_json:
        return

    state_delta: dict[str, Any] = json.loads(delta_json)
    event = Event(
        author="mila-inspect",
        invocation_id=str(state_delta.get("run_id") or "inspect-state-delta"),
        actions=EventActions(state_delta=state_delta),
    )
    await service.append_event(session=session, event=event)
    updated = await service.get_session(
        app_name=app_name,
        user_id=user_id,
        session_id=session_id,
    )
    _print_session("updated", updated)


def _print_session(label: str, session: Any) -> None:
    state = getattr(session, "state", None) or {}
    print(f"\n{label} session.id={getattr(session, 'id', '')}")
    print("state keys:")
    for key in sorted(state.keys()):
        print(f"- {key}")


def _configure_relative_credentials() -> None:
    raw = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not raw:
        return
    path = Path(raw)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    if path.is_file():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(path.resolve())


if __name__ == "__main__":
    asyncio.run(main())
