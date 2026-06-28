import unittest
from unittest.mock import patch

from entity.Batch import BatchModel
from services.agent_artifact_context import build_agent_artifact_manifest
from services.agent_gateway import _build_session_state


CONFIRMED_WEEK_1 = {
    "id": "lp-current",
    "type": "lesson_plan",
    "artifact_type": "lesson_plan",
    "week": 1,
    "title": "Week 1 Lesson Plan",
    "status": "confirmed",
    "is_current": True,
    "version": 2,
    "export_status": "exported",
    "content_json": {"title": "Sensitive full body"},
    "rendered_markdown": "# Sensitive markdown",
    "content_source": "agent_generated",
    "content_stale": False,
    "doc_url": "https://docs.google.com/document/d/week1/edit",
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-02T00:00:00Z",
}

SUPERSEDED_WEEK_1 = {
    "id": "lp-old",
    "type": "lesson_plan",
    "week": 1,
    "title": "Old Week 1",
    "status": "superseded",
    "is_current": False,
    "version": 1,
}

DRAFT_LAB_WEEK_2 = {
    "id": "lab-draft",
    "type": "lab",
    "artifact_type": "lab",
    "week": 2,
    "title": "Week 2 Lab Draft",
    "status": "draft",
    "is_current": False,
    "version": None,
    "export_status": "not_exported",
    "rendered_markdown": "Draft body",
}


class AgentArtifactManifestTests(unittest.TestCase):
    @patch("services.agent_artifact_context.list_artifacts")
    @patch("services.agent_artifact_context.artifact_summary")
    def test_manifest_is_lightweight_and_lists_current_weeks(self, mock_summary, mock_list):
        mock_summary.return_value = {
            "counts": {
                "lesson_plan": {"current": 1, "total": 2},
                "lab": {"current": 0, "total": 1},
            },
            "by_week": [],
        }
        mock_list.return_value = [CONFIRMED_WEEK_1, SUPERSEDED_WEEK_1, DRAFT_LAB_WEEK_2]

        manifest = build_agent_artifact_manifest("batch-1", "lecturer-1")

        self.assertEqual(manifest["status"], "available")
        self.assertEqual(manifest["current_weeks"]["lesson_plan"], [1])
        self.assertEqual(manifest["current_weeks"]["lab"], [])
        self.assertIn("lesson_plan weeks 1", manifest["summary_text"])
        ids = [item["artifact_id"] for item in manifest["items"]]
        self.assertIn("lp-current", ids)
        self.assertIn("lab-draft", ids)
        self.assertNotIn("lp-old", ids)
        for item in manifest["items"]:
            self.assertNotIn("content_json", item)
            self.assertNotIn("rendered_markdown", item)
        current = next(item for item in manifest["items"] if item["artifact_id"] == "lp-current")
        self.assertTrue(current["content_available"])

    @patch("services.agent_gateway.build_blueprint_status_context", return_value={})
    @patch("services.agent_gateway.build_agent_artifact_manifest")
    def test_build_session_state_includes_artifact_manifest(self, mock_manifest, _blueprint):
        mock_manifest.return_value = {
            "status": "available",
            "summary_text": "Current artifacts: lesson_plan weeks 1.",
            "items": [],
            "counts": {},
            "current_weeks": {"lesson_plan": [1]},
        }
        batch = BatchModel(
            batch_id="batch-1",
            batch_name="Batch 2026",
            course_name="Low Code",
            lecturer_id="lecturer-1",
            lecturer_email="teacher@example.com",
            academic_year="2026",
            term="1",
        )

        state = _build_session_state(
            run_id="run-1",
            chat_id="chat-1",
            agent_session_id="pnai-chat-1",
            rtdb_run_path="agentRuns/run-1",
            batch=batch,
            lecturer_id="lecturer-1",
            lecturer_email="teacher@example.com",
            connectors={"web_search": True},
        )

        self.assertEqual(state["artifact_manifest"]["status"], "available")
        self.assertEqual(state["artifact_manifest"]["current_weeks"]["lesson_plan"], [1])


if __name__ == "__main__":
    unittest.main()
