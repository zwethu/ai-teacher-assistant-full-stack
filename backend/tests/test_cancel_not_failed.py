"""Stopping a run must settle as cancelled, never as failed.

Cancelling early means nothing streamed, which trips the post-stream guard
"Agent Engine stream completed without any assistant text". That guard used to
run BEFORE the cancellation was handled, so pressing Stop produced a run the UI
reported as "Failed after N steps — The Agent Engine stream failed before
producing a final response."
"""

import unittest
from unittest.mock import AsyncMock, patch

from services import agent_gateway


class CancelIsNotFailureTests(unittest.IsolatedAsyncioTestCase):
    async def _run_with_cancel(self, chunks):
        async def fake_stream(**_kwargs):
            for chunk in chunks:
                yield chunk

        statuses: list[str] = []

        with (
            patch.object(agent_gateway, "stream_agent_response", fake_stream),
            patch.object(
                agent_gateway,
                "get_agent_engine_resource_name",
                return_value="projects/p/locations/l/reasoningEngines/e",
            ),
            patch.object(agent_gateway, "get_agent_session_state", new=AsyncMock(return_value={})),
            # Cancelled from the very first poll.
            patch.object(agent_gateway, "is_agent_run_cancelled", return_value=True),
            patch.object(agent_gateway, "CANCEL_POLL_SECONDS", 0),
            patch.object(agent_gateway, "write_stream_delta"),
            patch.object(agent_gateway, "write_stream_meta"),
            patch.object(agent_gateway, "write_run_event"),
            patch.object(agent_gateway, "write_final_message"),
            patch.object(agent_gateway, "finalize_open_run_steps"),
            patch.object(agent_gateway, "mark_agent_run_done"),
            patch.object(agent_gateway, "mark_agent_run_failed") as mark_failed,
            patch.object(agent_gateway, "add_message") as add_message,
            patch.object(agent_gateway, "set_run_status", side_effect=lambda _r, s: statuses.append(s)),
        ):
            await agent_gateway._run_agent_background(
                run_id="run-c",
                rtdb_run_path="agentRuns/run-c",
                batch_id="b1",
                chat_id="c1",
                agent_session_id="s1",
                lecturer_id="u1",
                user_message="Explain testing",
                session_state={"workflow_type": "", "save_draft": False, "pending_artifact": False},
            )
        return statuses, mark_failed, add_message

    async def test_cancel_before_any_text_is_cancelled_not_failed(self):
        statuses, mark_failed, add_message = await self._run_with_cancel(["hello "])
        self.assertIn("cancelled", statuses)
        self.assertNotIn("failed", statuses)
        mark_failed.assert_not_called()
        # No assistant message is persisted for a stopped run.
        add_message.assert_not_called()

    async def test_cancel_with_no_chunks_at_all(self):
        statuses, mark_failed, _ = await self._run_with_cancel([])
        self.assertNotIn("failed", statuses)
        mark_failed.assert_not_called()


if __name__ == "__main__":
    unittest.main()
