"""Phase 3: course_blueprint is a course-level two-stage workflow.

It supports outline->approve->full pending-artifact generation but, unlike
lesson_plan/assessment/lab, it never requires a `week` and never uses save_draft.
"""

import pytest
from fastapi import HTTPException

from routers.agent import AgentInvokeRequest, _validate_invoke_request


def _req(**kw) -> AgentInvokeRequest:
    base = dict(message="Plan the course", batch_id="b1")
    base.update(kw)
    return AgentInvokeRequest(**base)


def test_blueprint_outline_stage_without_week_ok():
    # Outline stage, pending artifact, NO week — must validate.
    _validate_invoke_request(
        _req(workflow_type="course_blueprint.generate", workflow_stage="outline", pending_artifact=True)
    )


def test_blueprint_full_stage_requires_approved_outline():
    with pytest.raises(HTTPException) as exc:
        _validate_invoke_request(
            _req(workflow_type="course_blueprint.generate", workflow_stage="full", pending_artifact=True)
        )
    assert exc.value.status_code == 400


def test_blueprint_full_stage_with_approval_ok():
    _validate_invoke_request(
        _req(
            workflow_type="course_blueprint.generate",
            workflow_stage="full",
            pending_artifact=True,
            approval_action="approve_outline",
            approved_outline_run_id="run_abc",
        )
    )


def test_blueprint_pending_artifact_recognized():
    # A bare pending_artifact request with the blueprint family must be accepted
    # (proves course_blueprint is in _PENDING_ARTIFACT_WORKFLOWS).
    _validate_invoke_request(_req(workflow_type="course_blueprint", pending_artifact=True))


def test_lesson_plan_still_requires_week_for_save_draft():
    # Regression: the week requirement for save_draft families is unchanged.
    with pytest.raises(HTTPException):
        _validate_invoke_request(_req(workflow_type="lesson_plan", save_draft=True))
