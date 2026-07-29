import unittest
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

from entity.Batch import BatchModel
from entity.CourseBlueprint import CourseBlueprintContent
from services import course_blueprint_service
from services import agent_gateway
from services.agent_gateway import _build_session_state


class CourseBlueprintValidationTests(unittest.TestCase):
    def test_requires_substantive_content(self):
        with self.assertRaises(ValidationError):
            CourseBlueprintContent(title="Plan")

    def test_week_numbers_are_unique_and_sorted(self):
        content = CourseBlueprintContent(
            title="Plan",
            weekly_plan=[{"week": 2, "theme": "B"}, {"week": 1, "theme": "A"}],
        )
        self.assertEqual([item.week for item in content.weekly_plan], [1, 2])
        with self.assertRaises(ValidationError):
            CourseBlueprintContent(
                title="Plan",
                weekly_plan=[{"week": 1, "theme": "A"}, {"week": 1, "theme": "B"}],
            )

    def test_recommendation_fields_are_sanitized_and_backward_compatible(self):
        content = CourseBlueprintContent(
            title=" Plan ",
            summary="Reusable",
            planning_horizon_weeks=8,
            plan_scope="full_course",
            assumptions=["  Assumption  "],
            source_summary="  Based on saved artifacts  ",
            weekly_plan=[{
                "week": 1, "theme": " Intro ",
                "source_status": "generated_artifact",
                "source_refs": [" lesson-1 ", "lesson-1"],
            }],
        )
        self.assertEqual(content.weekly_plan[0].theme, "Intro")
        self.assertEqual(content.weekly_plan[0].source_refs, ["lesson-1"])
        self.assertEqual(content.assumptions, ["Assumption"])
        legacy = CourseBlueprintContent(title="Legacy", summary="Existing plan")
        self.assertIsNone(legacy.plan_scope)
        fields = course_blueprint_service._content_fields(content)
        self.assertEqual(fields["plan_scope"], "full_course")
        self.assertEqual(fields["weekly_plan"][0]["source_status"], "generated_artifact")

    def test_message_eligibility_rejects_artifact_cards(self):
        eligible = {"role": "assistant", "content": "Seven-week roadmap", "metadata": {}}
        self.assertEqual(course_blueprint_service._is_ineligible_message(eligible), "")
        blocked = {**eligible, "metadata": {"artifact_preview_card": True}}
        self.assertIn("cannot be saved", course_blueprint_service._is_ineligible_message(blocked))


class CourseBlueprintContextTests(unittest.TestCase):
    @patch("services.course_blueprint_service.get_current_blueprint")
    def test_context_contains_only_requested_week(self, get_current):
        get_current.return_value = {
            "blueprint_id": "bp1", "version": 2, "summary": "Roadmap",
            "assessment_strategy": "Weekly checks", "lab_strategy": "Projects",
            "teaching_preferences": {"mode": "active"},
            "weekly_plan": [{"week": 1, "theme": "A"}, {"week": 2, "theme": "B"}],
        }
        context = course_blueprint_service.build_blueprint_session_context("b1", "u1", 2)
        self.assertEqual(context["course_blueprint_week_plan"]["week"], 2)
        self.assertNotIn("weekly_plan", context)

    @patch("services.course_blueprint_service.get_current_blueprint")
    def test_status_context_is_minimal_and_bounded(self, get_current):
        get_current.return_value = {
            "blueprint_id": "bp1", "version": 4, "summary": "S" * 1500,
            "weekly_plan": [{"week": 4, "theme": "Hidden from normal chat"}],
            "assessment_strategy": "Hidden strategy", "lab_strategy": "Hidden lab",
            "teaching_preferences": {"mode": "hidden"},
        }
        context = course_blueprint_service.build_blueprint_status_context("b1", "u1")
        self.assertEqual(context["course_blueprint_status"], "active")
        self.assertEqual(context["active_course_blueprint_version"], 4)
        self.assertEqual(len(context["course_blueprint_summary"]), 1000)
        self.assertEqual(context["course_blueprint_week_plan"], {})
        self.assertEqual(context["course_blueprint_assessment_strategy"], "")
        self.assertEqual(context["course_blueprint_lab_strategy"], "")
        self.assertEqual(context["course_blueprint_teaching_preferences"], {})

    @patch("services.course_blueprint_service.get_current_blueprint", return_value=None)
    def test_missing_status_context_uses_empty_defaults(self, _get_current):
        context = course_blueprint_service.build_blueprint_status_context("b1", "u1")
        self.assertEqual(context["course_blueprint_status"], "none")
        self.assertEqual(context["active_course_blueprint_id"], "")

    @patch("services.agent_gateway.build_blueprint_status_context")
    @patch("services.agent_gateway.build_blueprint_session_context")
    @patch("services.agent_gateway.build_agent_artifact_manifest", return_value={})
    def test_gateway_uses_full_generation_and_minimal_chat_context(
        self, _manifest, build_context, build_status
    ):
        build_context.return_value = {
            "active_course_blueprint_id": "bp1",
            "active_course_blueprint_version": 1,
            "course_blueprint_status": "active",
            "course_blueprint_summary": "Plan",
            "course_blueprint_week_plan": {"week": 3},
            "course_blueprint_assessment_strategy": "",
            "course_blueprint_lab_strategy": "",
            "course_blueprint_teaching_preferences": {},
        }
        batch = BatchModel(
            batch_id="b1", batch_name="Batch", course_name="Course",
            lecturer_id="u1", lecturer_email="u@example.com",
        )
        common = dict(
            run_id="r1", chat_id="c1", agent_session_id="s1", rtdb_run_path="agentRuns/r1",
            batch=batch, lecturer_id="u1", lecturer_email="u@example.com",
            connectors={"web_search": True}, week=3,
        )
        generated = _build_session_state(**common, workflow_type="lesson_plan")
        self.assertEqual(generated["active_course_blueprint_id"], "bp1")
        build_context.assert_called_once_with("b1", "u1", requested_week=3)
        build_status.assert_not_called()
        build_context.reset_mock()
        build_status.return_value = {
            "active_course_blueprint_id": "bp1",
            "active_course_blueprint_version": 1,
            "course_blueprint_status": "active",
            "course_blueprint_summary": "Plan",
            "course_blueprint_week_plan": {},
            "course_blueprint_assessment_strategy": "",
            "course_blueprint_lab_strategy": "",
            "course_blueprint_teaching_preferences": {},
        }
        consulted = _build_session_state(**common, workflow_type="")
        self.assertEqual(consulted["course_blueprint_status"], "active")
        self.assertEqual(consulted["course_blueprint_week_plan"], {})
        self.assertEqual(consulted["course_blueprint_assessment_strategy"], "")
        build_context.assert_not_called()
        build_status.assert_called_once_with("b1", "u1")


class CourseBlueprintSuggestionPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_consultant_hint_is_ignored(self):
        """Consultant-suggested blueprint saving was removed on purpose.

        Lecturers now build a course plan deliberately through the Course Plan
        workflow, so a stale session hint must not resurrect the save prompt.
        """
        async def fake_stream(**_kwargs):
            yield "Reusable seven-week roadmap"

        hint = {
            "suggested": True, "confidence": "high", "run_id": "run-hint",
            "source_agent": "course_consultant_agent", "suggested_title": "Roadmap",
            "reason": "Reusable course planning",
            "blueprint": {
                "title": "Roadmap", "summary": "Reusable seven-week roadmap",
                "weekly_plan": [], "assessment_strategy": "", "lab_strategy": "",
                "teaching_preferences": {}, "open_questions": [],
                "plan_scope": "full_course",
            },
        }
        with (
            patch.object(agent_gateway, "stream_agent_response", fake_stream),
            patch.object(agent_gateway, "get_agent_engine_resource_name", return_value="projects/p/locations/l/reasoningEngines/e"),
            patch.object(agent_gateway, "get_agent_session_state", new=AsyncMock(return_value={"course_blueprint_save_suggestion": hint})),
            patch.object(agent_gateway, "write_stream_delta"),
            patch.object(agent_gateway, "write_stream_meta"),
            patch.object(agent_gateway, "write_run_event"),
            patch.object(agent_gateway, "write_final_message"),
            patch.object(agent_gateway, "mark_agent_run_done"),
            patch.object(agent_gateway, "set_run_status"),
            patch.object(agent_gateway, "add_message", return_value={"message_id": "m1"}) as add_message,
            patch.object(course_blueprint_service, "save_blueprint_from_message") as save_blueprint,
        ):
            await agent_gateway._run_agent_background(
                run_id="run-hint", rtdb_run_path="agentRuns/run-hint",
                batch_id="b1", chat_id="c1", agent_session_id="s1",
                lecturer_id="u1", user_message="Plan my course",
                session_state={"workflow_type": "", "save_draft": False, "pending_artifact": False},
            )

        metadata = add_message.call_args.kwargs["metadata"]
        self.assertNotIn("course_blueprint_save_suggested", metadata)
        self.assertNotIn("course_blueprint_recommendation", metadata)
        self.assertNotIn("course_blueprint_suggestion_run_id", metadata)
        save_blueprint.assert_not_called()


if __name__ == "__main__":
    unittest.main()
