"""The RTDB final message must carry the Firestore message id.

The client reads `agentRuns/{run_id}/messages/{id}` and keeps whatever
`message_id` it finds, then addresses that message by id when the lecturer hits
retry (DELETE) or exports a single response. When RTDB minted its own id those
calls 404'd against a message Firestore had never heard of, and retry silently
did nothing.
"""

import unittest
from unittest.mock import AsyncMock, patch

from services import agent_gateway


class FinalMessageIdContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_rtdb_final_message_uses_the_firestore_id(self):
        async def fake_stream(**_kwargs):
            yield "Here is the answer."

        with (
            patch.object(agent_gateway, "stream_agent_response", fake_stream),
            patch.object(
                agent_gateway,
                "get_agent_engine_resource_name",
                return_value="projects/p/locations/l/reasoningEngines/e",
            ),
            patch.object(agent_gateway, "get_agent_session_state", new=AsyncMock(return_value={})),
            patch.object(agent_gateway, "write_stream_delta"),
            patch.object(agent_gateway, "write_stream_meta"),
            patch.object(agent_gateway, "write_run_event"),
            patch.object(agent_gateway, "mark_agent_run_done"),
            patch.object(agent_gateway, "set_run_status"),
            patch.object(
                agent_gateway, "add_message", return_value={"message_id": "firestore-id-1"}
            ),
            patch.object(agent_gateway, "write_final_message") as write_final,
        ):
            await agent_gateway._run_agent_background(
                run_id="run-1",
                rtdb_run_path="agentRuns/run-1",
                batch_id="b1",
                chat_id="c1",
                agent_session_id="s1",
                lecturer_id="u1",
                user_message="Explain unit testing",
                session_state={"workflow_type": "", "save_draft": False, "pending_artifact": False},
            )

        write_final.assert_called()
        self.assertEqual(
            write_final.call_args.kwargs.get("message_id"),
            "firestore-id-1",
            "RTDB must publish the Firestore id, or retry/export cannot address the message",
        )


if __name__ == "__main__":
    unittest.main()
