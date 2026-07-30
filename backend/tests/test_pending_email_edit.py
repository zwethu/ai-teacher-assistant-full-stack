"""Editing a staged email, and handing the edit off to the send path.

The edit endpoint used to read the run with ``get_agent_run``, whose ``_run_to_dict``
projection flattens ``pending_artifact`` to a bool — the run-creation request flag lives
under the same key as the staged artifact dict. That made every save return 404 "No
pending email for this run". These tests drive the real Firestore projection so a swap
back to the flattening reader fails here instead of in the UI.
"""

import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from routers.chats import (
    UpdatePendingEmailBody,
    _claim_pending_email,
    update_pending_email_endpoint,
)
from services.artifact_service import content_hash

BATCH_ID = "batch-1"
CHAT_ID = "chat-1"
RUN_ID = "run-1"
LECTURER = {"uid": "lecturer-1"}

_ORIGINAL = {
    "recipients": ["a@example.com", "b@example.com"],
    "subject": "Quiz on Friday",
    "body": "Original body.",
}


def _pending(**overrides) -> dict:
    content = overrides.pop("content_json", dict(_ORIGINAL))
    return {
        "pending_artifact_id": f"pending_{RUN_ID}",
        "artifact_type": "email",
        "workflow_type": "email",
        "title": content["subject"],
        "content_json": content,
        "content_hash": content_hash(content),
        "source_run_id": RUN_ID,
        "status": "pending_export",
        **overrides,
    }


# ---------------------------------------------------------------------------
# Fake Firestore — just enough chaining for _chat_ref / _run_ref
# ---------------------------------------------------------------------------

class _Snap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class _Doc:
    def __init__(self, data, children=None):
        self._data = data
        self._children = children or {}

    def get(self):
        return _Snap(self._data)

    def collection(self, name):
        return self._children.get(name, _Col({}))


class _Col:
    def __init__(self, docs):
        self._docs = docs

    def document(self, doc_id):
        return self._docs.get(doc_id, _Doc(None))


def _fake_db(run_doc: dict, chat_doc: dict | None = None):
    """A db where batches/{b}/chats/{c}/runs/{r} resolves to run_doc."""
    chat = chat_doc if chat_doc is not None else {"lecturer_id": LECTURER["uid"]}
    runs = _Col({RUN_ID: _Doc(run_doc)})
    chats = _Col({CHAT_ID: _Doc(chat, {"runs": runs})})
    batches = _Col({BATCH_ID: _Doc({}, {"chats": chats})})

    class _DB:
        def collection(self, name):
            return batches if name == "batches" else _Col({})

    return _DB()


def _save(body: UpdatePendingEmailBody, run_doc: dict, chat_doc: dict | None = None):
    """Run the edit endpoint against a fake run doc; returns (result, written_pending)."""
    written: dict = {}

    def _capture(*, batch_id, chat_id, run_id, pending_artifact):
        written.update(pending_artifact)

    with (
        patch("services.agent_sessions.get_firestore", return_value=_fake_db(run_doc, chat_doc)),
        patch("routers.chats.mark_agent_run_pending_artifact", side_effect=_capture),
        patch("routers.chats.update_assistant_message_content_for_run") as msg_update,
    ):
        result = asyncio.run(
            update_pending_email_endpoint(
                batch_id=BATCH_ID,
                chat_id=CHAT_ID,
                run_id=RUN_ID,
                body=body,
                current_user=LECTURER,
            )
        )
    return result, written, msg_update


def _run_doc(pending: dict | None = None, **overrides) -> dict:
    return {
        "run_id": RUN_ID,
        "status": "done",
        "pending_artifact": pending if pending is not None else _pending(),
        **overrides,
    }


# ---------------------------------------------------------------------------
# The regression: the staged dict has to survive the read
# ---------------------------------------------------------------------------

def test_edit_saves_against_a_staged_email():
    body = UpdatePendingEmailBody(subject="Quiz moved to Monday", body="Updated body.")
    result, written, msg_update = _save(body, _run_doc())

    assert result["success"] is True
    assert result["subject"] == "Quiz moved to Monday"
    assert result["body"] == "Updated body."
    # Recipients are untouched when the body omits them.
    assert result["recipients"] == _ORIGINAL["recipients"]
    assert result["recipient_count"] == 2
    assert written["content_json"]["subject"] == "Quiz moved to Monday"
    assert written["edited_by_lecturer"] is True
    # The rendered card is rewritten so it cannot drift from what will be sent.
    assert msg_update.called
    assert "Quiz moved to Monday" in msg_update.call_args.kwargs["content"]


def test_edit_does_not_read_the_run_through_the_flattening_projection():
    """get_agent_run projects pending_artifact to a bool; using it here 404s every save."""
    from services.agent_sessions import get_agent_run, get_agent_run_with_pending_artifact

    with patch("services.agent_sessions.get_firestore", return_value=_fake_db(_run_doc())):
        flattened = get_agent_run(
            batch_id=BATCH_ID, chat_id=CHAT_ID, run_id=RUN_ID, lecturer_id=LECTURER["uid"]
        )
        preserved = get_agent_run_with_pending_artifact(
            batch_id=BATCH_ID, chat_id=CHAT_ID, run_id=RUN_ID, lecturer_id=LECTURER["uid"]
        )

    assert flattened["pending_artifact"] is True
    assert isinstance(preserved["pending_artifact"], dict)
    assert preserved["pending_artifact"]["artifact_type"] == "email"


def test_edit_can_replace_recipients():
    body = UpdatePendingEmailBody(
        subject="S", body="B", recipients=["  new@example.com  ", "", "second@example.com"]
    )
    result, written, _ = _save(body, _run_doc())

    assert result["recipients"] == ["new@example.com", "second@example.com"]
    assert written["content_json"]["recipients"] == ["new@example.com", "second@example.com"]


# ---------------------------------------------------------------------------
# Edit → send: the hash the edit writes must satisfy the send-path validation
# ---------------------------------------------------------------------------

def test_edited_email_passes_the_send_path_hash_check():
    body = UpdatePendingEmailBody(subject="Edited subject", body="Edited body.")
    _, written, _ = _save(body, _run_doc())

    # The send path re-hashes content_json and refuses on mismatch, so an edit that
    # rewrote content without rewriting the hash would strand the draft at 409.
    # claim_pending_artifact_export stamps the lock and flips status before returning.
    claimed = {**written, "status": "exporting", "export_lock_id": "lock-1"}
    claim = {"state": "claimed", "pending_artifact": claimed, "export_lock_id": "lock-1"}
    with patch("routers.chats.claim_pending_artifact_export", return_value=claim):
        early, pending, content, lock, mark_failed = _claim_pending_email(
            BATCH_ID, CHAT_ID, RUN_ID, LECTURER["uid"]
        )

    assert early is None
    assert content["subject"] == "Edited subject"
    assert content["body"] == "Edited body."
    assert content["recipients"] == _ORIGINAL["recipients"]
    assert lock == "lock-1"
    assert content_hash(content) == pending["content_hash"]


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

def test_edit_404s_when_nothing_is_staged():
    with pytest.raises(HTTPException) as exc:
        _save(UpdatePendingEmailBody(subject="S", body="B"), _run_doc(pending=True))
    assert exc.value.status_code == 404
    assert exc.value.detail == "No pending email for this run"


def test_edit_404s_for_an_unknown_run():
    with pytest.raises(HTTPException) as exc:
        _save(UpdatePendingEmailBody(subject="S", body="B"), None)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Run not found"


def test_edit_404s_for_another_lecturers_chat():
    with pytest.raises(HTTPException) as exc:
        _save(
            UpdatePendingEmailBody(subject="S", body="B"),
            _run_doc(),
            chat_doc={"lecturer_id": "someone-else"},
        )
    assert exc.value.status_code == 404


def test_edit_rejects_a_non_email_pending_artifact():
    with pytest.raises(HTTPException) as exc:
        _save(
            UpdatePendingEmailBody(subject="S", body="B"),
            _run_doc(_pending(artifact_type="quiz")),
        )
    assert exc.value.status_code == 400


def test_edit_conflicts_once_the_send_has_claimed_the_draft():
    with pytest.raises(HTTPException) as exc:
        _save(
            UpdatePendingEmailBody(subject="S", body="B"),
            _run_doc(_pending(status="exporting")),
        )
    assert exc.value.status_code == 409


def test_edit_requires_subject_and_body():
    for subject, text in (("   ", "B"), ("S", "   ")):
        with pytest.raises(HTTPException) as exc:
            _save(UpdatePendingEmailBody(subject=subject, body=text), _run_doc())
        assert exc.value.status_code == 400
        assert exc.value.detail == "Subject and body are required"


def test_edit_requires_at_least_one_recipient():
    with pytest.raises(HTTPException) as exc:
        _save(
            UpdatePendingEmailBody(subject="S", body="B", recipients=["  ", ""]),
            _run_doc(_pending(content_json={**_ORIGINAL, "recipients": []})),
        )
    assert exc.value.status_code == 400
    assert exc.value.detail == "At least one recipient is required"
