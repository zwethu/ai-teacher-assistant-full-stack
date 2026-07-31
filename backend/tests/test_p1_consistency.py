"""P1 consistency: sources rendering, outline hash integrity, snapshot normalization."""

import services.agent_gateway as gw
from services.agent_sessions import _content_hash
from services.artifact_renderers.lab_markdown import render_lab_markdown
from services.artifact_renderers.lesson_plan_markdown import render_lesson_plan_markdown
from services.artifact_renderers.quiz_markdown import render_quiz_markdown

_SOURCES = [
    {"title": "Slides W3", "source_type": "course_material", "file_title": "week3.pdf"},
    {"title": "CS Guide", "source_type": "web", "url": "https://guide.example.edu/sorting"},
]


def test_quiz_markdown_renders_sources_section():
    payload = {
        "title": "Quiz W3", "description": "d", "week": 3,
        "questions": [{"question_text": "Q1", "question_type": "short_answer", "points": 2}],
        "sources": _SOURCES,
    }
    md = render_quiz_markdown(payload)
    assert "## Sources" in md
    assert "week3.pdf" in md
    assert "https://guide.example.edu/sorting" in md


def test_lab_markdown_renders_sources_section():
    payload = {
        "title": "Lab W3", "week": 3, "topic": "Sorting",
        "sources": _SOURCES,
    }
    md = render_lab_markdown(payload)
    assert "## Sources" in md
    assert "week3.pdf" in md


def test_lesson_plan_markdown_renders_doc_only_fields():
    payload = {
        "title": "W3 Plan", "subject": "SE", "week": 3,
        "objectives": [{"objective": "o1", "bloom_level": "apply"}],
        "type_specific_plan": {"case_study": "ACME sorting pipeline"},
        "assessment": {"type": "formative", "title": "Check", "description": "d",
                       "estimated_time": 15},
        "homework": {"title": "HW", "description": "d", "tasks": ["t1"],
                     "resources_needed": ["textbook ch. 4"]},
        "activities": [{
            "title": "A1", "duration_minutes": 10, "activity_type": "lecture",
            "description": "d",
            "materials_table": [{"item": "GPU", "qty": "2"}],
        }],
    }
    md = render_lesson_plan_markdown(payload)
    assert "Type-Specific Plan" in md
    assert "ACME sorting pipeline" in md
    assert "formative — 15 min" in md
    assert "textbook ch. 4" in md
    assert "Materials Table" in md and "GPU" in md


def test_outline_content_hash_stable_and_order_independent():
    a = {"title": "T", "week": 3, "objectives": ["x"]}
    b = {"week": 3, "objectives": ["x"], "title": "T"}
    assert _content_hash(a) == _content_hash(b)
    assert _content_hash(a) != _content_hash({**a, "week": 4})


def test_outline_context_snapshot_normalizes_blueprint_json_string():
    snapshot = gw.outline_context_snapshot(
        {
            "course_blueprint_outline": '{"title": "SE Course", "planning_horizon_weeks": 12}',
            "research_summary": "r",
        }
    )
    assert isinstance(snapshot["course_blueprint_outline"], dict)
    assert snapshot["course_blueprint_outline"]["title"] == "SE Course"
    assert snapshot["research_summary"] == "r"
