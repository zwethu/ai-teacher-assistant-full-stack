"""Print deployed Agent Engine operation schemas."""

from __future__ import annotations

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
    _get_agent,
    get_agent_engine_resource_name,
)


def main() -> None:
    _configure_relative_credentials()

    import vertexai

    resource_name = get_agent_engine_resource_name()
    if not resource_name:
        raise SystemExit("Set AGENT_ENGINE_RESOURCE_NAME or AGENT_ENGINE_URL first.")

    agent = _get_agent(vertexai, resource_name)
    schemas: Any = agent.operation_schemas()
    print(json.dumps(schemas, indent=2, default=str))
    print(f"\nasync_stream_query_has_state_input={_async_stream_query_has_state_input(schemas)}")


def _async_stream_query_has_state_input(schemas: Any) -> bool:
    for operation in _iter_operations(schemas):
        name = str(operation.get("name") or operation.get("operation_id") or "").lower()
        if "async_stream_query" not in name and "stream_query" not in name:
            continue
        input_schema = (
            operation.get("input_schema")
            or operation.get("parameters")
            or operation.get("request")
            or operation
        )
        if _schema_has_state_property(input_schema):
            return True
    return False


def _iter_operations(value: Any):
    if isinstance(value, list):
        for item in value:
            yield from _iter_operations(item)
    elif isinstance(value, dict):
        if any(key in value for key in ("name", "operation_id", "input_schema", "parameters")):
            yield value
        for item in value.values():
            yield from _iter_operations(item)


def _schema_has_state_property(value: Any) -> bool:
    if isinstance(value, dict):
        properties = value.get("properties")
        if isinstance(properties, dict) and "state" in properties:
            return True
        return any(_schema_has_state_property(item) for item in value.values())
    if isinstance(value, list):
        return any(_schema_has_state_property(item) for item in value)
    return False


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
    main()
