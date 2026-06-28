import unittest
from unittest.mock import MagicMock, patch

from services.agent_sessions import _run_to_dict
from utils import rtdb_client


class HistoricalRunTimelineTests(unittest.TestCase):
    def test_rtdb_snapshot_is_bounded_and_normalized(self):
        raw = {
            "status": "done",
            "events": {
                "event-b": {"kind": "tool", "created_at": 2, "summary": "done"},
                "event-a": {"kind": "thinking", "created_at": 1, "summary": "working"},
            },
            "steps": {
                "step-a": {"title": "Research", "status": "done", "updated_at": 3},
            },
        }
        ref = MagicMock()
        ref.get.return_value = raw
        with patch.object(rtdb_client, "_ensure_init", return_value=True), patch.object(
            rtdb_client, "_ref", return_value=ref
        ):
            snapshot = rtdb_client.read_run_timeline_snapshot("run-1")

        self.assertEqual([event["event_id"] for event in snapshot["events"]], ["event-a", "event-b"])
        self.assertEqual(snapshot["steps"]["step-a"]["step_id"], "step-a")
        self.assertEqual(snapshot["status"], "done")

    def test_durable_run_response_includes_timeline(self):
        timeline = {"status": "done", "events": [], "steps": {}}
        result = _run_to_dict({"run_id": "run-1", "status": "done", "timeline_snapshot": timeline})
        self.assertEqual(result["timeline_snapshot"], timeline)


if __name__ == "__main__":
    unittest.main()
