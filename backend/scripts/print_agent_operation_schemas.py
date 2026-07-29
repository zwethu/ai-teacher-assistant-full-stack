"""Print operation_schemas() for the configured deployed Agent Engine."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parents[1]))

from services.agent_engine_client import get_agent_engine_resource_name  # noqa: E402


def main() -> None:
    import vertexai

    resource_name = get_agent_engine_resource_name()
    if not resource_name:
        raise SystemExit("Set AGENT_ENGINE_RESOURCE_NAME or AGENT_ENGINE_URL first.")

    project = __import__("os").getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    location = __import__("os").getenv("AGENT_ENGINE_LOCATION", "us-central1").strip()

    client_cls = getattr(vertexai, "Client", None)
    if client_cls is not None:
        try:
            agent = client_cls(project=project, location=location).agent_engines.get(
                name=resource_name
            )
        except AttributeError:
            agent = _preview_agent(vertexai, project, location, resource_name)
    else:
        agent = _preview_agent(vertexai, project, location, resource_name)

    schemas: Any = agent.operation_schemas()
    print(json.dumps(schemas, indent=2, default=str))


def _preview_agent(vertexai_module: Any, project: str, location: str, resource_name: str) -> Any:
    from vertexai.preview import reasoning_engines

    vertexai_module.init(project=project, location=location)
    return reasoning_engines.ReasoningEngine(resource_name)


if __name__ == "__main__":
    main()
