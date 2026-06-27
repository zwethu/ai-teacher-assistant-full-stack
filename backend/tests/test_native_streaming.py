import unittest
from unittest.mock import MagicMock, patch

from services import agent_gateway
from utils import rtdb_client


class NativeStreamingTest(unittest.IsolatedAsyncioTestCase):
    def test_preview_card_metadata_is_limited_to_lesson_plans_and_labs(self) -> None:
        lesson = agent_gateway._draft_message_metadata(
            {"id": "a1", "artifact_type": "lesson_plan", "title": "Week 1"}
        )
        quiz = agent_gateway._draft_message_metadata(
            {"id": "a2", "artifact_type": "quiz", "title": "Quiz 1"}
        )
        pending_lab = agent_gateway._pending_artifact_message_metadata(
            {"pending_artifact_id": "p1", "artifact_type": "lab", "title": "Lab 1"}
        )

        self.assertTrue(lesson["artifact_preview_card"])
        self.assertEqual(lesson["artifact_title"], "Week 1")
        self.assertFalse(quiz["artifact_preview_card"])
        self.assertTrue(pending_lab["artifact_preview_card"])
        self.assertEqual(pending_lab["artifact_title"], "Lab 1")

    async def test_gateway_preserves_one_delta_per_upstream_chunk(self) -> None:
        chunks = ["  Native ", "response.\n"]

        async def fake_stream(**_kwargs):
            for chunk in chunks:
                yield chunk

        with (
            patch.object(agent_gateway, "stream_agent_response", fake_stream),
            patch.object(agent_gateway, "write_stream_delta") as write_delta,
            patch.object(agent_gateway, "write_stream_meta"),
            patch.object(agent_gateway, "write_run_event"),
            patch.object(agent_gateway, "add_message", return_value={"message_id": "m1"}) as add_message,
            patch.object(agent_gateway, "write_final_message"),
            patch.object(agent_gateway, "mark_agent_run_done"),
            patch.object(agent_gateway, "set_run_status"),
        ):
            await agent_gateway._run_agent_background(
                run_id="run1",
                rtdb_run_path="agentRuns/run1",
                batch_id="batch1",
                chat_id="chat1",
                agent_session_id="session1",
                lecturer_id="lecturer1",
                user_message="hello",
                session_state={"save_draft": False, "pending_artifact": False},
            )

        self.assertEqual(write_delta.call_count, len(chunks))
        for index, chunk in enumerate(chunks):
            write_delta.assert_any_call(
                "run1",
                index,
                chunk,
                source="agent_engine",
                mode="native",
                upstream_event_kind="final_text",
            )
        self.assertEqual(add_message.call_args.args[3], "".join(chunks))

    def test_stream_delta_metadata_is_optional_and_persisted(self) -> None:
        ref = MagicMock()
        with (
            patch.object(rtdb_client, "_ensure_init", return_value=True),
            patch.object(rtdb_client, "_ref", return_value=ref),
        ):
            rtdb_client.write_stream_delta(
                "run1",
                2,
                "delta",
                source="agent_engine",
                mode="native",
                upstream_event_kind="final_text",
            )

        payload = ref.set.call_args.args[0]
        self.assertEqual(payload["source"], "agent_engine")
        self.assertEqual(payload["mode"], "native")
        self.assertEqual(payload["upstream_event_kind"], "final_text")

    def test_backend_run_event_uses_shared_schema(self) -> None:
        ref = MagicMock()
        with (
            patch.object(rtdb_client, "_ensure_init", return_value=True),
            patch.object(rtdb_client, "_ref", return_value=ref),
        ):
            rtdb_client.write_run_event(
                "run1",
                event_type="draft_save.started",
                status="started",
                title="Saving draft",
                batch_id="batch1",
                chat_id="chat1",
            )

        payload = ref.set.call_args.args[0]
        self.assertEqual(payload["schema_version"], "pnai.run_event.v1")
        self.assertEqual(payload["source"], "backend")
        self.assertEqual(payload["event_type"], "draft_save.started")


if __name__ == "__main__":
    unittest.main()
