"""Inspect the configured deployed Agent Engine.

By default this script only reads agent metadata and optional session state.
It creates a session only when INSPECT_CREATE_SESSION=true is set.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(BACKEND_DIR))

load_dotenv(BACKEND_DIR / ".env")

from services.agent_engine_client import (  # noqa: E402
    _create_or_get_session,
    _get_agent,
    get_agent_engine_resource_name,
)


async def main() -> None:
    import vertexai

    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    location = os.getenv("AGENT_ENGINE_LOCATION", "us-central1").strip()
    resource_name = get_agent_engine_resource_name()
    if not resource_name:
        raise SystemExit("Set AGENT_ENGINE_RESOURCE_NAME or AGENT_ENGINE_URL first.")

    print(f"project={project}")
    print(f"location={location}")
    print(f"resource_name={resource_name}")

    agent = _get_agent(vertexai, resource_name)
    print("\noperation_schemas:")
    print(json.dumps(agent.operation_schemas(), indent=2, default=str))

    user_id = os.getenv("TEST_AGENT_USER_ID", "").strip()
    session_id = os.getenv("TEST_AGENT_SESSION_ID", "").strip()
    if not user_id or not session_id:
        print("\nSet TEST_AGENT_USER_ID and TEST_AGENT_SESSION_ID to inspect a session.")
        return

    print(f"\nsession check user_id={user_id} session_id={session_id}")
    try:
        session: Any = await agent.async_get_session(
            user_id=user_id,
            session_id=session_id,
        )
        print("session exists:")
        print(json.dumps(session, indent=2, default=str))
        return
    except Exception as exc:
        print(f"async_get_session failed: {exc.__class__.__name__}: {exc}")

    should_create = os.getenv("INSPECT_CREATE_SESSION", "").strip().lower() == "true"
    if not should_create:
        print("INSPECT_CREATE_SESSION is not true; not creating a session.")
        return

    print("INSPECT_CREATE_SESSION=true; creating or reusing session.")
    await _create_or_get_session(
        session_id=session_id,
        lecturer_id=user_id,
        resource_name=resource_name,
        agent=agent,
    )
    print("session create/reuse completed.")


if __name__ == "__main__":
    asyncio.run(main())
