import unittest
from unittest.mock import patch

from fastapi import HTTPException

from routers.agent import AgentInvokeRequest, _validate_invoke_request
from services import agent_gateway
from services.artifact_renderers.quiz_markdown import render_quiz_markdown


class TwoStageArtifactTest(unittest.TestCase):
    def test_outline_request_and_quiz_pending_are_accepted(self) -> None:
        body = AgentInvokeRequest(
            message="quiz", batch_id="b", workflow_type="assessment.generate",
            workflow_stage="outline", pending_artifact=True,
        )
        _validate_invoke_request(body)

    def test_full_pending_requires_approved_outline(self) -> None:
        body = AgentInvokeRequest(
            message="full", batch_id="b", workflow_type="lab.generate",
            workflow_stage="full", pending_artifact=True,
        )
        with self.assertRaises(HTTPException):
            _validate_invoke_request(body)

    def test_outline_extraction_and_markdown(self) -> None:
        state = {"lesson_plan_outline": {
            "title": "Week 1", "week": 1, "subject": "Power BI",
            "objectives": [{"objective": "Build a report"}],
            "topics_covered": ["Data import"],
        }}
        artifact_type, payload = agent_gateway.extract_outline_from_state(
            state, "lesson_plan.generate"
        )
        self.assertEqual(artifact_type, "lesson_plan")
        self.assertIn("Build a report", agent_gateway.render_outline_markdown(artifact_type, payload))

    def test_quiz_pending_target_and_preview(self) -> None:
        quiz = {
            "title": "Week 3 Quiz", "description": "Check understanding", "week": 3,
            "questions": [{"question_text": "What is X?", "question_type": "short_answer", "points": 2}],
        }
        with patch.object(agent_gateway, "mark_agent_run_pending_artifact"):
            pending = agent_gateway.maybe_store_pending_artifact_from_session(
                batch_id="b", lecturer_id="u", chat_id="c", run_id="r",
                state={"active_artifact_type": "quiz", "quiz_full": quiz},
                rendered_markdown="", lecturer_email="", workflow_type="assessment.generate",
                requested_week=3,
            )
        self.assertIsNotNone(pending)
        metadata = agent_gateway._pending_artifact_message_metadata(pending)
        self.assertEqual(metadata["pending_export_target"], "google_forms")
        self.assertIn("What is X?", render_quiz_markdown(quiz))


if __name__ == "__main__":
    unittest.main()
