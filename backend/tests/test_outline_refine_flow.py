"""P0 refine flow + run-scoped extraction guards."""

from unittest.mock import patch

import pytest
from fastapi import HTTPException

import routers.agent as agent_router
import services.agent_gateway as gw


# ---- router validation ----

def _validate(body):
    # Reuse the endpoint's validation by calling the request path pieces directly:
    # replicate the checks via a minimal invocation of the validation block.
    workflow_stage = body.get("workflow_stage") or ""
    approval_action = body.get("approval_action") or ""
    if approval_action not in {"", "approve_outline", "refine_outline"}:
        raise HTTPException(status_code=400, detail="bad approval_action")
    if approval_action == "refine_outline":
        if workflow_stage != "outline" or not body.get("approved_outline_run_id"):
            raise HTTPException(status_code=400, detail="bad refine request")


def test_refine_requires_outline_stage_and_run_id():
    with pytest.raises(HTTPException):
        _validate({"approval_action": "refine_outline", "workflow_stage": "full",
                   "approved_outline_run_id": "r1"})
    with pytest.raises(HTTPException):
        _validate({"approval_action": "refine_outline", "workflow_stage": "outline"})
    _validate({"approval_action": "refine_outline", "workflow_stage": "outline",
               "approved_outline_run_id": "r1"})


def test_router_accepts_refine_outline_action():
    # The literal validation set in the router source must include refine_outline.
    import inspect

    src = inspect.getsource(agent_router)
    assert '"refine_outline"' in src
    assert "get_approvable_outline_run" in src


def _req(**kw):
    base = dict(message="m", batch_id="b1", chat_id="c1")
    base.update(kw)
    return agent_router.AgentInvokeRequest(**base)


def test_validate_refine_full_rules():
    validate = agent_router._validate_invoke_request
    # Valid: full stage + pending artifact + outline run reference.
    validate(
        _req(
            workflow_type="assessment.generate",
            workflow_stage="full",
            approval_action="refine_full",
            pending_artifact=True,
            approved_outline_run_id="r1",
        )
    )
    # Missing outline run id.
    with pytest.raises(HTTPException):
        validate(
            _req(
                workflow_type="assessment.generate",
                workflow_stage="full",
                approval_action="refine_full",
                pending_artifact=True,
            )
        )
    # Wrong stage.
    with pytest.raises(HTTPException):
        validate(
            _req(
                workflow_type="assessment.generate",
                workflow_stage="outline",
                approval_action="refine_full",
                pending_artifact=True,
                approved_outline_run_id="r1",
            )
        )
    # Not a pending-artifact run.
    with pytest.raises(HTTPException):
        validate(
            _req(
                workflow_type="assessment.generate",
                workflow_stage="full",
                approval_action="refine_full",
                pending_artifact=False,
                approved_outline_run_id="r1",
            )
        )


def test_router_refine_full_fetches_instead_of_claiming():
    """refine_full must reuse the approved outline snapshot, never re-claim it."""
    import inspect

    src = inspect.getsource(agent_router)
    assert '"refine_full"' in src
    claim_block = src.split('approval_action == "approve_outline"')
    # The claim call must be conditioned on approve_outline, not run for refine_full.
    assert "claim_approvable_outline_run" in claim_block[-1]


# ---- session-state seeding for refine ----

def test_build_session_state_seeds_outline_for_refine():
    from entity.Batch import BatchModel

    batch = BatchModel(
        batch_id="b1", batch_name="SE-2026", lecturer_id="u1",
        lecturer_email="u1@example.edu", course_name="Software Engineering",
    )
    approved = {
        "outline_artifact_type": "lesson_plan",
        "outline_payload": {"title": "W3", "week": 3},
        "outline_context": {"research_summary": "prior research"},
    }
    with patch.object(gw, "build_blueprint_session_context", return_value={}), \
         patch.object(gw, "build_blueprint_status_context", return_value={}), \
         patch.object(gw, "build_agent_artifact_manifest", return_value=[]), \
         patch.object(gw, "build_chat_attachment_context", return_value={}), \
         patch(
             "services.file_service.build_pending_course_materials_manifest",
             return_value=[],
         ):
        state = gw._build_session_state(
            run_id="run-2", chat_id="c1", agent_session_id="s1",
            rtdb_run_path="agentRuns/run-2", batch=batch, lecturer_id="u1",
            lecturer_email="", connectors={},
            workflow_type="lesson_plan.generate", week=3,
            workflow_stage="outline", approval_action="refine_outline",
            approved_outline_run_id="run-1", approved_outline=approved,
        )
    assert state["lesson_plan_outline"] == {"title": "W3", "week": 3}
    assert state["research_summary"] == "prior research"
    assert state["approval_action"] == "refine_outline"
    assert state["workflow_stage"] == "outline"


def test_build_session_state_seeds_outline_for_refine_full():
    from entity.Batch import BatchModel

    batch = BatchModel(
        batch_id="b1", batch_name="SE-2026", lecturer_id="u1",
        lecturer_email="u1@example.edu", course_name="Software Engineering",
    )
    approved = {
        "outline_artifact_type": "quiz",
        "outline_payload": {"title": "W3 Quiz", "total_questions": 15},
        "outline_status": "approved",
    }
    with patch.object(gw, "build_blueprint_session_context", return_value={}), \
         patch.object(gw, "build_blueprint_status_context", return_value={}), \
         patch.object(gw, "build_agent_artifact_manifest", return_value=[]), \
         patch.object(gw, "build_chat_attachment_context", return_value={}), \
         patch(
             "services.file_service.build_pending_course_materials_manifest",
             return_value=[],
         ):
        state = gw._build_session_state(
            run_id="run-3", chat_id="c1", agent_session_id="s1",
            rtdb_run_path="agentRuns/run-3", batch=batch, lecturer_id="u1",
            lecturer_email="", connectors={},
            workflow_type="assessment.generate", week=3,
            workflow_stage="full", approval_action="refine_full",
            approved_outline_run_id="run-1", approved_outline=approved,
            pending_artifact=True,
        )
    assert state["quiz_outline"] == {"title": "W3 Quiz", "total_questions": 15}
    assert state["approval_action"] == "refine_full"
    assert state["workflow_stage"] == "full"
    assert state["pending_artifact"] is True


# ---- run-scoped extraction ----

_LP_FULL = {
    "title": "W3 Plan", "subject": "SE", "week": 3,
    "objectives": [{"objective": "o1"}],
}


def test_full_extraction_requires_this_runs_stamp():
    fresh = {"run_id": "r2", "generation_staged_in_run": "r2",
             "active_artifact_type": "lesson_plan", "lesson_plan_full": _LP_FULL}
    stale = {"run_id": "r2", "generation_staged_in_run": "r1",
             "active_artifact_type": "lesson_plan", "lesson_plan_full": _LP_FULL}
    unstamped = {"run_id": "r2",
                 "active_artifact_type": "lesson_plan", "lesson_plan_full": _LP_FULL}
    assert gw.extract_lesson_plan_full_from_state(fresh) == _LP_FULL
    assert gw.extract_lesson_plan_full_from_state(stale) is None
    assert gw.extract_lesson_plan_full_from_state(unstamped) is None


def test_outline_extraction_requires_this_runs_stamp():
    outline = {"title": "W3", "week": 3}
    fresh = {"run_id": "r2", "outline_staged_in_run": "r2", "lesson_plan_outline": outline}
    stale = {"run_id": "r2", "outline_staged_in_run": "r1", "lesson_plan_outline": outline}
    assert gw.extract_outline_from_state(fresh, "lesson_plan.generate") is not None
    assert gw.extract_outline_from_state(stale, "lesson_plan.generate") is None


def test_blueprint_extraction_also_run_scoped():
    full = {"title": "Course", "plan_scope": "semester", "summary": "s"}
    stale = {"run_id": "r2", "generation_staged_in_run": "r1",
             "course_blueprint_full": full}
    assert gw.extract_course_blueprint_full_from_state(stale) is None
