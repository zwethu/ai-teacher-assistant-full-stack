"""Phase 3 backend: course-blueprint extraction, metadata, and preview rendering."""

from unittest.mock import patch

from entity.Batch import BatchModel
from services.agent_gateway import (
    _build_session_state,
    _pending_artifact_message_metadata,
    extract_course_blueprint_full_from_state,
    extract_outline_from_state,
    outline_context_snapshot,
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
    assert extract_course_blueprint_full_from_state({"run_id": "r1", "generation_staged_in_run": "r1", "course_blueprint_full": _FULL}) == _FULL
    assert extract_course_blueprint_full_from_state({"run_id": "r1", "generation_staged_in_run": "r1", "course_blueprint_full": {"title": "x"}}) is None
    # active_artifact_type mismatch is rejected
    assert extract_course_blueprint_full_from_state(
        {"run_id": "r1", "generation_staged_in_run": "r1", "active_artifact_type": "lesson_plan", "course_blueprint_full": _FULL}
    ) is None


def test_extract_full_normalizes_generated_preference_entries():
    generated = {
        **_FULL,
        "teaching_preferences": [
            {"key": "pedagogy", "value": "active learning"},
            {"key": "delivery", "value": "project based"},
        ],
    }
    extracted = extract_course_blueprint_full_from_state(
        {"run_id": "r1", "generation_staged_in_run": "r1", "course_blueprint_full": generated}
    )
    assert extracted is not None
    assert extracted["teaching_preferences"] == {
        "pedagogy": "active learning",
        "delivery": "project based",
    }


def test_extract_outline_blueprint_needs_no_week():
    result = extract_outline_from_state(
        {"run_id": "r1", "outline_staged_in_run": "r1", "course_blueprint_outline": _OUTLINE}, "course_blueprint.generate"
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


def test_build_session_state_injects_approved_course_blueprint_outline():
    batch = BatchModel(
        batch_id="batch-1",
        batch_name="Software Testing 26",
        course_name="Software Testing",
        lecturer_id="lecturer-1",
        lecturer_email="teacher@example.com",
        academic_year="2026",
        term="1",
    )
    with (
        patch("services.agent_gateway.build_blueprint_session_context", return_value={}),
        patch("services.agent_gateway.build_agent_artifact_manifest", return_value={"status": "empty"}),
    ):
        state = _build_session_state(
            run_id="run-full",
            chat_id="chat-1",
            agent_session_id="session-1",
            rtdb_run_path="agentRuns/run-full",
            batch=batch,
            lecturer_id="lecturer-1",
            lecturer_email="teacher@example.com",
            connectors={"web_search": True},
            workflow_type="course_blueprint.generate",
            workflow_stage="full",
            approval_action="approve_outline",
            approved_outline_run_id="run-outline",
            approved_outline={
                "outline_artifact_type": "course_blueprint",
                "outline_payload": _OUTLINE,
                "outline_context": outline_context_snapshot({"run_id": "r1", "outline_staged_in_run": "r1", "course_blueprint_outline": _OUTLINE}),
            },
        )
    assert state["course_blueprint_outline"] == _OUTLINE


def test_outline_context_snapshot_includes_course_blueprint_outline():
    outline = {"title": "Plan", "plan_scope": "full_course", "weekly_themes": []}
    snap = outline_context_snapshot({"course_blueprint_outline": outline, "research_summary": "done"})
    assert snap["course_blueprint_outline"] == outline
