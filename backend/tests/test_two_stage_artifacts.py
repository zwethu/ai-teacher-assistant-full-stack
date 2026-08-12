import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import BackgroundTasks, HTTPException

from routers.agent import AgentInvokeRequest, _validate_invoke_request
from routers import chats
from services import agent_gateway, agent_sessions
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
        state = {"run_id": "r1", "outline_staged_in_run": "r1", "lesson_plan_outline": {
            "title": "Week 1", "week": 1, "subject": "Power BI",
            "objectives": [{"objective": "Build a report"}],
            "topics_covered": ["Data import"],
        }}
        artifact_type, payload = agent_gateway.extract_outline_from_state(
            state, "lesson_plan.generate"
        )
        self.assertEqual(artifact_type, "lesson_plan")
        self.assertIn("Build a report", agent_gateway.render_outline_markdown(artifact_type, payload))

    def test_outline_metadata_preserves_distinct_presenter_intro(self) -> None:
        payload = {
            "title": "Week 1 Outline",
            "week": 1,
            "subject": "Power BI",
            "objectives": [{"objective": "Build a report"}],
            "topics_covered": ["Data import"],
        }
        outline_markdown = agent_gateway.render_outline_markdown("lesson_plan", payload)
        metadata = {
            "workflow_stage": "outline",
            "outline_approvable": True,
            "pending_exportable": False,
            "exportable": False,
        }

        agent_gateway._attach_assistant_intro(
            metadata,
            "The lesson plan outline is ready for your review.",
            outline_markdown,
        )

        self.assertEqual(
            metadata["assistant_intro"],
            "The lesson plan outline is ready for your review.",
        )
        self.assertFalse(metadata["pending_exportable"])
        self.assertFalse(metadata["exportable"])

    def test_quiz_pending_target_and_preview(self) -> None:
        quiz = {
            "title": "Week 3 Quiz", "description": "Check understanding", "week": 3,
            "questions": [{"question_text": "What is X?", "question_type": "short_answer", "points": 2}],
        }
        with patch.object(agent_gateway, "mark_agent_run_pending_artifact"):
            pending = agent_gateway.maybe_store_pending_artifact_from_session(
                batch_id="b", lecturer_id="u", chat_id="c", run_id="r",
                state={"run_id": "r", "generation_staged_in_run": "r", "active_artifact_type": "quiz", "quiz_full": quiz},
                rendered_markdown="", lecturer_email="", workflow_type="assessment.generate",
                requested_week=3,
            )
        self.assertIsNotNone(pending)
        metadata = agent_gateway._pending_artifact_message_metadata(pending)
        self.assertEqual(metadata["pending_export_target"], "google_forms")
        self.assertIn("What is X?", render_quiz_markdown(quiz))


class OutlineFollowupInvalidationTest(unittest.IsolatedAsyncioTestCase):
    def test_ready_outline_is_transactionally_superseded(self) -> None:
        class Snapshot:
            def __init__(self, data):
                self.exists = True
                self._data = data

            def to_dict(self):
                return self._data

        class Ref:
            def __init__(self, data):
                self.snapshot = Snapshot(data)

            def get(self, transaction=None):
                return self.snapshot

        class Transaction:
            def __init__(self):
                self.updates = []

            def update(self, ref, values):
                self.updates.append((ref, values))

        transaction = Transaction()
        chat_ref = Ref({"lecturer_id": "u", "latest_outline_run_id": "outline-run"})
        run_ref = Ref({"outline_status": "ready"})
        database = MagicMock()
        database.transaction.return_value = transaction

        with (
            patch.object(agent_sessions, "get_firestore", return_value=database),
            patch.object(agent_sessions, "_chat_ref", return_value=chat_ref),
            patch.object(agent_sessions, "_run_ref", return_value=run_ref),
            patch.object(agent_sessions.firestore, "transactional", side_effect=lambda fn: fn),
        ):
            run_id = agent_sessions.invalidate_latest_outline_for_followup(
                batch_id="b", chat_id="c", lecturer_id="u"
            )

        self.assertEqual(run_id, "outline-run")
        self.assertEqual(transaction.updates[0][1]["outline_status"], "superseded")
        self.assertEqual(transaction.updates[1][1]["latest_outline_run_id"], "")

    async def test_normal_followup_supersedes_latest_outline_before_starting_run(self) -> None:
        with (
            patch.object(chats, "get_chat", return_value={"chat_id": "c"}),
            patch.object(
                chats,
                "invalidate_latest_outline_for_followup",
                return_value="outline-run",
            ) as invalidate,
            patch.object(chats, "update_assistant_message_metadata_for_run") as update_message,
            patch.object(chats, "apply_feature_stress"),
            patch.object(
                chats,
                "start_chat_run",
                new=AsyncMock(return_value={"run_id": "next-run", "status": "running"}),
            ) as start_run,
        ):
            result = await chats.send_message_endpoint(
                batch_id="b",
                chat_id="c",
                body=chats.SendMessageBody(content="Replace two true/false questions"),
                background_tasks=BackgroundTasks(),
                current_user={"uid": "u", "email": "teacher@example.com"},
            )

        invalidate.assert_called_once_with(batch_id="b", chat_id="c", lecturer_id="u")
        update_message.assert_called_once_with(
            batch_id="b",
            chat_id="c",
            run_id="outline-run",
            metadata={"outline_approval_status": "superseded"},
        )
        self.assertEqual(start_run.await_args.kwargs.get("workflow_stage", ""), "")
        self.assertEqual(result["run_id"], "next-run")


if __name__ == "__main__":
    unittest.main()
