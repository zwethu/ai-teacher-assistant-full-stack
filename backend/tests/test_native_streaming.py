import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from services import agent_gateway
from utils import rtdb_client


class NativeStreamingTest(unittest.IsolatedAsyncioTestCase):
    def test_web_search_metadata_is_bounded_and_sanitized(self) -> None:
        state = {
            "last_web_search": {
                "status": "success",
                "extraction_mode": "grounding_metadata",
                "queries": [f"query {index}" for index in range(12)],
                "sources": [
                    {"index": 1, "title": "Official", "url": "https://example.edu/path#fragment", "supports": "Evidence"},
                    {"index": 2, "title": "Unsafe", "url": "javascript:alert(1)"},
                ],
                "citations": [
                    {"index": 1, "source_index": 1, "url": "https://wrong.example", "cited_text": "Claim"},
                    {"index": 2, "source_index": 99, "url": "https://missing.example"},
                ],
            }
        }
        result = agent_gateway._web_search_message_metadata(
            state, visible_text="Answer [1]", message_metadata={}
        )
        self.assertTrue(result["web_search_used"])
        self.assertEqual(len(result["web_queries"]), 8)
        self.assertEqual(result["web_sources"][0]["url"], "https://example.edu/path")
        self.assertEqual(result["web_citations"][0]["url"], "https://example.edu/path")
        self.assertEqual(len(result["web_sources"]), 1)

    def test_web_search_metadata_skips_failed_and_unreferenced_cards(self) -> None:
        source = {"index": 1, "title": "Official", "url": "https://example.edu/path"}
        self.assertEqual(
            agent_gateway._web_search_message_metadata(
                {"last_web_search": {"status": "failed", "sources": [source]}},
                visible_text="Answer",
                message_metadata={},
            ),
            {},
        )
        grouped = agent_gateway._web_search_message_metadata(
            {"last_web_search": {"status": "success", "sources": [source]}},
            visible_text="Preview uses [1, 2]",
            message_metadata={"artifact_preview_card": True},
        )
        self.assertTrue(grouped["web_search_used"])
        self.assertEqual(
            agent_gateway._web_search_message_metadata(
                {"last_web_search": {"status": "success", "sources": [source]}},
                visible_text="# Artifact preview",
                message_metadata={"artifact_preview_card": True},
            ),
            {},
        )

    def test_web_search_metadata_supports_twenty_sources_and_forty_citations(self) -> None:
        sources = [
            {"index": index, "title": f"Source {index}", "url": f"https://source{index}.example/path"}
            for index in range(1, 26)
        ]
        citations = [
            {"index": index, "source_index": ((index - 1) % 20) + 1, "cited_text": f"Claim {index}"}
            for index in range(1, 46)
        ]
        result = agent_gateway._web_search_message_metadata(
            {"last_web_search": {
                "status": "success", "extraction_mode": "grounding_metadata",
                "queries": ["query"], "sources": sources, "citations": citations,
            }},
            visible_text="Answer [11]", message_metadata={},
        )
        self.assertEqual(len(result["web_sources"]), 20)
        self.assertEqual(len(result["web_citations"]), 40)
        self.assertEqual(result["web_source_count"], 20)
        self.assertEqual(result["web_citation_count"], 40)
        self.assertEqual(result["web_sources"][10]["index"], 11)

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
        self.assertTrue(quiz["artifact_preview_card"])
        self.assertTrue(pending_lab["artifact_preview_card"])
        self.assertEqual(pending_lab["artifact_title"], "Lab 1")

    def test_assistant_intro_is_kept_only_when_distinct_from_preview(self) -> None:
        metadata = {}
        agent_gateway._attach_assistant_intro(metadata, "Generation complete.", "# Preview")
        self.assertEqual(metadata["assistant_intro"], "Generation complete.")

        duplicate = {}
        agent_gateway._attach_assistant_intro(duplicate, "# Preview", "  # Preview  ")
        self.assertNotIn("assistant_intro", duplicate)

        empty = {}
        agent_gateway._attach_assistant_intro(empty, "", "# Preview")
        self.assertNotIn("assistant_intro", empty)

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

    async def test_all_full_artifact_cards_preserve_presenter_intro(self) -> None:
        for artifact_type, workflow_type in (
            ("lesson_plan", "lesson_plan.generate"),
            ("lab", "lab.generate"),
            ("quiz", "assessment.generate"),
        ):
            with self.subTest(artifact_type=artifact_type):
                async def fake_stream(**_kwargs):
                    yield "Generation is complete."

                pending = {
                    "pending_artifact_id": f"pending-{artifact_type}",
                    "artifact_type": artifact_type,
                    "title": f"{artifact_type} preview",
                    "week": 4,
                    "content_hash": "hash",
                    "preview_markdown": f"# {artifact_type} preview",
                }
                with (
                    patch.object(agent_gateway, "stream_agent_response", fake_stream),
                    patch.object(agent_gateway, "get_agent_session_state", new=AsyncMock(return_value={})),
                    patch.object(
                        agent_gateway,
                        "maybe_store_pending_artifact_from_session",
                        return_value=pending,
                    ),
                    patch.object(agent_gateway, "write_stream_delta"),
                    patch.object(agent_gateway, "write_stream_meta"),
                    patch.object(agent_gateway, "write_run_event"),
                    patch.object(
                        agent_gateway,
                        "add_message",
                        return_value={"message_id": "m1"},
                    ) as add_message,
                    patch.object(agent_gateway, "write_final_message"),
                    patch.object(agent_gateway, "mark_agent_run_done"),
                    patch.object(agent_gateway, "set_run_status"),
                ):
                    await agent_gateway._run_agent_background(
                        run_id=f"run-{artifact_type}",
                        rtdb_run_path=f"agentRuns/run-{artifact_type}",
                        batch_id="batch1",
                        chat_id="chat1",
                        agent_session_id="session1",
                        lecturer_id="lecturer1",
                        user_message="generate",
                        session_state={
                            "save_draft": False,
                            "pending_artifact": True,
                            "workflow_stage": "full",
                            "workflow_type": workflow_type,
                            "approved_outline_run_id": "outline-run",
                        },
                    )

                metadata = add_message.call_args.kwargs["metadata"]
                self.assertEqual(metadata["assistant_intro"], "Generation is complete.")
                self.assertEqual(add_message.call_args.args[3], pending["preview_markdown"])
                self.assertTrue(metadata["artifact_preview_card"])

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

    def test_finalize_open_run_steps_only_closes_non_terminal_steps(self) -> None:
        ref = MagicMock()
        ref.get.return_value = {
            "research": {"status": "started", "title": "Searching"},
            "tool": {"status": "done", "title": "Tool complete"},
            "optional": {"status": "failed", "title": "Optional lookup failed"},
        }
        with (
            patch.object(rtdb_client, "_ensure_init", return_value=True),
            patch.object(rtdb_client, "_ref", return_value=ref),
        ):
            rtdb_client.finalize_open_run_steps("run1", "done")

        updates = ref.update.call_args.args[0]
        self.assertEqual(updates["research/status"], "done")
        self.assertIn("research/updated_at", updates)
        self.assertNotIn("tool/status", updates)
        self.assertNotIn("optional/status", updates)

    def test_finalize_open_run_steps_marks_open_steps_failed(self) -> None:
        ref = MagicMock()
        ref.get.return_value = {"research": {"status": "running"}}
        with (
            patch.object(rtdb_client, "_ensure_init", return_value=True),
            patch.object(rtdb_client, "_ref", return_value=ref),
        ):
            rtdb_client.finalize_open_run_steps("run1", "failed")

        self.assertEqual(ref.update.call_args.args[0]["research/status"], "failed")


if __name__ == "__main__":
    unittest.main()
