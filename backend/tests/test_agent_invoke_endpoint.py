"""Real-endpoint tests for /agent/invoke across ALL workflows and HITL actions.

Regression for the refine_outline NameError: the earlier test replicated the
router's validation logic instead of exercising the endpoint, so an undefined
variable inside invoke_agent survived to runtime. These tests run the actual
FastAPI route with auth overridden and services patched.
"""

from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routers.agent as agent_router
from utils.firebase_auth import get_current_user
from utils.stress_guard import stress_guard


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(agent_router.router, prefix="/agent")
    app.dependency_overrides[get_current_user] = lambda: {
        "uid": "lecturer-1",
        "email": "l@example.edu",
    }
    # The stress meter lives in Firestore; keep the endpoint tests hermetic.
    app.dependency_overrides[stress_guard] = lambda: None
    with TestClient(app) as test_client:
        yield test_client


async def _fake_start_chat_run(**kwargs):
    return {
        "user_message": {"message_id": "m1"},
        "run_id": "run-new",
        "rtdb_run_path": "agentRuns/run-new",
        "status": "running",
    }


_CHAT = {"chat_id": "chat-1", "lecturer_id": "lecturer-1"}


def _invoke(client, **overrides):
    body = {
        "message": "generate",
        "batch_id": "batch-1",
        "chat_id": "chat-1",
        **overrides,
    }
    with (
        patch.object(agent_router, "apply_feature_stress"),
        patch.object(agent_router, "get_chat", return_value=_CHAT),
        patch.object(agent_router, "get_or_create_workflow_chat", return_value=dict(_CHAT)),
        patch.object(agent_router, "start_chat_run", _fake_start_chat_run),
        patch.object(
            agent_router,
            "get_approvable_outline_run",
            return_value={
                "outline_artifact_type": "lesson_plan",
                "outline_payload": {"title": "T", "week": 3},
                "outline_context": {},
            },
        ),
        patch.object(agent_router, "invalidate_latest_outline_for_followup", return_value="run-old"),
        patch.object(agent_router, "update_assistant_message_metadata_for_run"),
        patch.object(
            agent_router,
            "claim_approvable_outline_run",
            return_value={
                "outline_artifact_type": "lesson_plan",
                "outline_payload": {"title": "T", "week": 3},
                "outline_context": {},
            },
        ),
    ):
        return client.post("/agent/invoke", json=body)


@pytest.mark.parametrize(
    "workflow_type",
    ["lesson_plan.generate", "lab.generate", "assessment.generate", "course_blueprint.generate"],
)
def test_outline_stage_invoke_succeeds_for_every_workflow(client, workflow_type):
    resp = _invoke(
        client,
        workflow_type=workflow_type,
        workflow_stage="outline",
        pending_artifact=True,
        week=3,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["run_id"] == "run-new"


@pytest.mark.parametrize(
    "workflow_type",
    ["lesson_plan.generate", "lab.generate", "assessment.generate", "course_blueprint.generate"],
)
def test_refine_outline_invoke_succeeds_for_every_workflow(client, workflow_type):
    resp = _invoke(
        client,
        workflow_type=workflow_type,
        workflow_stage="outline",
        approval_action="refine_outline",
        approved_outline_run_id="run-old",
        week=3,
    )
    assert resp.status_code == 200, resp.text


def test_approve_outline_invoke_succeeds(client):
    resp = _invoke(
        client,
        workflow_type="lesson_plan.generate",
        workflow_stage="full",
        approval_action="approve_outline",
        approved_outline_run_id="run-old",
        pending_artifact=True,
        week=3,
    )
    assert resp.status_code == 200, resp.text


def test_refine_without_run_id_is_rejected(client):
    resp = _invoke(
        client,
        workflow_type="lesson_plan.generate",
        workflow_stage="outline",
        approval_action="refine_outline",
    )
    assert resp.status_code == 400


def test_plain_chat_invoke_succeeds(client):
    resp = _invoke(client)
    assert resp.status_code == 200
