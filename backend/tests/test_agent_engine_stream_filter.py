import unittest
from unittest.mock import patch

from services import agent_engine_client
from services.agent_engine_client import (
    _event_author,
    _event_is_partial,
    _event_text,
    _recover_final_chunks_from_stream_exception,
)


class AgentEngineStreamFilterTest(unittest.TestCase):
    def test_native_root_delta_is_visible(self) -> None:
        event = {
            "author": "pnai_root_agent",
            "partial": True,
            "content": {"role": "model", "parts": [{"text": "Done"}]},
        }
        self.assertEqual(_event_author(event), "pnai_root_agent")
        self.assertTrue(_event_is_partial(event))
        self.assertEqual(_event_text(event), "Done")

    def test_both_root_agent_names_pass_the_public_filter(self):
        # The brand sweep renamed the root agent; an engine deployed before it
        # still says pnai_root_agent. Both must stream to the lecturer.
        from services.agent_engine_client import _PUBLIC_RESPONSE_AUTHORS

        self.assertIn("mila_root_agent", _PUBLIC_RESPONSE_AUTHORS)
        self.assertIn("pnai_root_agent", _PUBLIC_RESPONSE_AUTHORS)

    def test_tool_and_thought_parts_are_hidden(self) -> None:
        tool = {"content": {"parts": [{"function_call": {"name": "worker"}}]}}
        mixed_tool = {
            "content": {
                "parts": [
                    {"text": "I will call a worker."},
                    {"function_call": {"name": "worker"}},
                ]
            }
        }
        thought = {"content": {"parts": [{"text": "secret", "thought": True}]}}
        self.assertEqual(_event_text(tool), "")
        self.assertEqual(_event_text(mixed_tool), "")
        self.assertEqual(_event_text(thought), "")

    def test_recovery_prefers_root_partials_and_excludes_child_json(self) -> None:
        raw = (
            '{"author":"lesson_plan_full_generator","partial":true,'
            '"content":{"parts":[{"text":"{\\"title\\":\\"Hidden\\"}"}]}}'
            '{"author":"pnai_root_agent","partial":true,'
            '"content":{"parts":[{"text":"Native "}]}}'
            '{"author":"pnai_root_agent","partial":true,'
            '"content":{"parts":[{"text":"response"}]}}'
            '{"author":"pnai_root_agent","partial":false,'
            '"content":{"parts":[{"text":"Native response"}]}}'
        )
        exc = RuntimeError(f"Raw response: {raw}")
        self.assertEqual(
            _recover_final_chunks_from_stream_exception(exc),
            ["Native ", "response"],
        )


class AgentEngineNativeSseTest(unittest.IsolatedAsyncioTestCase):
    async def test_sdk_stream_requests_sse_and_preserves_root_partials(self) -> None:
        events = [
            {"author": "lesson_plan_full_generator", "partial": True,
             "content": {"parts": [{"text": "hidden json"}]}},
            {"author": "pnai_root_agent", "partial": True,
             "content": {"parts": [{"text": "Native "}]}},
            {"author": "pnai_root_agent", "partial": True,
             "content": {"parts": [{"text": "response"}]}},
            {"author": "pnai_root_agent", "partial": False,
             "content": {"parts": [{"text": "Native response"}]}},
        ]

        class FakeAgent:
            def __init__(self):
                self.kwargs = None

            async def async_stream_query(self, **kwargs):
                self.kwargs = kwargs
                for event in events:
                    yield event

        fake_agent = FakeAgent()
        with (
            patch.object(agent_engine_client, "_get_agent", return_value=fake_agent),
            patch.object(agent_engine_client, "ensure_session_with_state"),
        ):
            chunks = [
                chunk
                async for chunk in agent_engine_client._sdk_stream(
                    user_message="hello",
                    session_id="session1",
                    lecturer_id="user1",
                    session_state={},
                    resource_name="projects/p/locations/l/reasoningEngines/r",
                )
            ]

        self.assertEqual(chunks, ["Native ", "response"])
        self.assertEqual(fake_agent.kwargs["run_config"], {"streaming_mode": "sse"})

    async def test_sdk_stream_keeps_single_root_aggregate(self) -> None:
        class FakeAgent:
            async def async_stream_query(self, **_kwargs):
                yield {
                    "author": "pnai_root_agent",
                    "partial": False,
                    "content": {"parts": [{"text": "Atomic response"}]},
                }

        with (
            patch.object(agent_engine_client, "_get_agent", return_value=FakeAgent()),
            patch.object(agent_engine_client, "ensure_session_with_state"),
        ):
            chunks = [
                chunk
                async for chunk in agent_engine_client._sdk_stream(
                    user_message="hello",
                    session_id="session1",
                    lecturer_id="user1",
                    session_state={},
                    resource_name="projects/p/locations/l/reasoningEngines/r",
                )
            ]
        self.assertEqual(chunks, ["Atomic response"])


if __name__ == "__main__":
    unittest.main()
