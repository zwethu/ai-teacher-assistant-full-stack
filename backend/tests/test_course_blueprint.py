import unittest
from unittest.mock import patch

from pydantic import ValidationError

from entity.Batch import BatchModel
from entity.CourseBlueprint import CourseBlueprintContent
from services import course_blueprint_service
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

    @patch("services.agent_gateway.build_blueprint_session_context")
    @patch("services.agent_gateway.build_agent_artifact_manifest", return_value={})
    def test_gateway_injects_for_generation_only(self, _manifest, build_context):
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
        build_context.reset_mock()
        consulted = _build_session_state(**common, workflow_type="")
        self.assertEqual(consulted["course_blueprint_status"], "none")
        build_context.assert_not_called()


if __name__ == "__main__":
    unittest.main()
