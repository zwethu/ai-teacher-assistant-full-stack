import unittest

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


if __name__ == "__main__":
    unittest.main()
