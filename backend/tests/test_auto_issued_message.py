"""Requests a UI control issued on the lecturer's behalf are marked as such.

Approving an outline has to send the agent *some* sentence — it needs a turn to
answer — but that sentence was composed by the client, not typed. The flag
written here is what lets the transcript leave it out while still showing a
reply the lecturer actually wrote.
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from services import agent_gateway as gw


class _PassThroughFirestore:
    """Runs the transaction body inline — see tests/test_chat_preview.py."""

    @staticmethod
    def transactional(fn):
        return fn

    class Query:
        DESCENDING = "DESCENDING"


# --- chat_service: the flag reaches the document, and the caller -----------------

def _commit(monkeypatch, **kwargs):
    from services import chat_service as cs

    monkeypatch.setattr(cs, "firestore", _PassThroughFirestore)
    chat_snap = MagicMock(); chat_snap.exists = True
    chat_snap.to_dict.return_value = {"lecturer_id": "lect-1", "preview": "earlier"}

    db = MagicMock()
    db.collection.return_value.document.return_value.collection.return_value.document.return_value.get.return_value = chat_snap
    monkeypatch.setattr(cs, "get_firestore", lambda: db)

    message, _ = cs.add_user_message_with_attachments(
        batch_id="batch-1", chat_id="chat-1", content="Approve this outline.",
        lecturer_id="lect-1", run_id="run-1", attachment_ids=[], **kwargs,
    )
    return db.transaction.return_value.set.call_args.args[1], message


def test_metadata_is_persisted_and_returned(monkeypatch):
    doc, message = _commit(monkeypatch, metadata={"auto_generated": True})
    assert doc["metadata"] == {"auto_generated": True}
    # The frontend replaces its optimistic copy with this one, so it has to
    # carry the flag too or the message would appear the moment it lands.
    assert message["metadata"] == {"auto_generated": True}


def test_a_typed_message_carries_no_metadata_key(monkeypatch):
    doc, message = _commit(monkeypatch)
    assert "metadata" not in doc
    assert message["metadata"] == {}


# --- agent_gateway: only the approval button gets the flag -----------------------

def _start_run(monkeypatch, *, approval_action: str, workflow_type: str):
    """Drive start_chat_run far enough to see the user message it writes."""
    captured = {}

    def _add_user_message(**kw):
        captured.update(kw)
        return {"message_id": "m1"}, []

    for name, value in {
        "get_batch": lambda *a, **k: {"batch_id": "b1"},
        "get_agent_engine_resource_name": lambda: "projects/p/locations/l/reasoningEngines/1",
        "preflight_sync_artifacts_for_agent_run": lambda **k: {"status": "ok"},
        "add_user_message_with_attachments": _add_user_message,
        "ensure_chat_agent_session": lambda **k: ("sess-1", True),
        "create_run_meta": lambda **k: None,
        "create_agent_run_record": lambda **k: None,
        "_build_session_state": lambda **k: {},
        "stash_run_dispatch": lambda **k: None,
        "dispatch_agent_run": lambda *a, **k: None,
    }.items():
        monkeypatch.setattr(gw, name, value)

    asyncio.run(gw.start_chat_run(
        user_message="Approve this outline and generate the full lab preview.",
        batch_id="b1", chat_id="c1", lecturer_id="u1", lecturer_email="u@x.io",
        connectors={}, background_tasks=MagicMock(),
        workflow_type=workflow_type, workflow_stage="full",
        approval_action=approval_action, approved_outline_run_id="run-outline",
    ))
    return captured["metadata"]


@pytest.mark.parametrize("workflow_type", [
    "lab.generate", "lesson_plan.generate", "assessment.generate", "course_blueprint.generate",
])
def test_approval_button_is_marked_for_every_workflow(monkeypatch, workflow_type):
    assert _start_run(monkeypatch, approval_action="approve_outline",
                      workflow_type=workflow_type) == {"auto_generated": True}


@pytest.mark.parametrize("approval_action", ["", "refine_outline"])
def test_the_lecturers_own_words_are_never_marked(monkeypatch, approval_action):
    # "refine_outline" is a reply they typed into the composer. Marking it would
    # erase their side of the conversation.
    assert _start_run(monkeypatch, approval_action=approval_action,
                      workflow_type="lab.generate") is None
