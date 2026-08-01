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


def test_lab_starter_files_render_in_chat_and_docs():
    from services.google_workspace.docs_rendering.schemas import LabFull
    from services.google_workspace.docs_rendering.lab_builder import LabDocBuilder

    payload = {
        "title": "Lab W2", "week": 2, "topic": "Testing",
        "starter_files": [
            {"path": "tests/test_math.py", "language": "python", "content": "def test_add():\n    assert 1 + 1 == 2"},
            {"path": "solutions/answers.py", "language": "python", "file_role": "solution", "content": "ANSWER = 42"},
        ],
    }
    md = render_lab_markdown(payload)
    assert "Lab Files (starter scaffold)" in md
    assert "tests/test_math.py" in md and "def test_add" in md

    lab = LabFull.model_validate(payload)
    lect_text = " ".join(getattr(b, "text", "") for b in LabDocBuilder(lab, mode="lecturer").build())
    stud_text = " ".join(getattr(b, "text", "") for b in LabDocBuilder(lab, mode="student").build())
    assert "tests/test_math.py" in lect_text and "ANSWER = 42" in lect_text
    assert "tests/test_math.py" in stud_text and "ANSWER = 42" not in stud_text
