"""Phase 3 backend: course-blueprint extraction, metadata, and preview rendering."""

from services.agent_gateway import (
    _pending_artifact_message_metadata,
    extract_course_blueprint_full_from_state,
    extract_outline_from_state,
    render_outline_markdown,
)
from services.artifact_service import render_course_blueprint_markdown

_FULL = {
    "title": "AI Foundations",
    "plan_scope": "full_course",
    "summary": "A 3-week intro to AI.",
    "planning_horizon_weeks": 3,
    "weekly_plan": [{"week": 1, "theme": "Intro", "lesson_goal": "Define AI"}],
    "assessment_strategy": "Weekly quizzes",
    "lab_strategy": "Colab",
    "teaching_preferences": {"pedagogy": "active"},
}

_OUTLINE = {
    "title": "AI Foundations",
    "plan_scope": "full_course",
    "summary": "3-week intro",
    "weekly_themes": [{"week": 1, "theme": "Intro"}, {"week": 2, "theme": "Training"}],
    "assessment_strategy_summary": "Quizzes",
}


def test_extract_full_requires_title_and_scope():
    assert extract_course_blueprint_full_from_state({"course_blueprint_full": _FULL}) == _FULL
    assert extract_course_blueprint_full_from_state({"course_blueprint_full": {"title": "x"}}) is None
    # active_artifact_type mismatch is rejected
    assert extract_course_blueprint_full_from_state(
        {"active_artifact_type": "lesson_plan", "course_blueprint_full": _FULL}
    ) is None


def test_extract_outline_blueprint_needs_no_week():
    result = extract_outline_from_state(
        {"course_blueprint_outline": _OUTLINE}, "course_blueprint.generate"
    )
    assert result is not None
    artifact_type, payload = result
    assert artifact_type == "course_blueprint"
    assert payload["title"] == "AI Foundations"  # accepted despite having no week


def test_pending_metadata_blueprint_is_savable_not_exportable():
    pending = {"pending_artifact_id": "pending_run_1", "artifact_type": "course_blueprint",
               "title": "AI Foundations", "content_hash": "abc", "week": None}
    md = _pending_artifact_message_metadata(pending)
    assert md["pending_savable_blueprint"] is True
    assert md["pending_exportable"] is False
    assert md["pending_export_target"] == "course_blueprint"


def test_pending_metadata_quiz_still_exportable():
    md = _pending_artifact_message_metadata({"artifact_type": "quiz", "week": 1})
    assert md["pending_exportable"] is True
    assert md["pending_export_target"] == "google_forms"
    assert md.get("pending_savable_blueprint") is False


def test_render_markdown_blueprint():
    assert "AI Foundations" in render_outline_markdown("course_blueprint", _OUTLINE)
    assert "Week 1" in render_course_blueprint_markdown(_FULL)
