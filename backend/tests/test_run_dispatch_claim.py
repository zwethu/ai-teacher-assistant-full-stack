"""Once-only dispatch claim, including the cancelled case.

Matters because each deferred run now schedules its own timeout task keyed on
run_id. That task fires whether or not the run is still awaiting anything, so the
claim is the thing standing between a stopped run and being silently restarted.
"""

from unittest.mock import MagicMock

import pytest

from services import agent_sessions as sessions


class _PassThroughFirestore:
    """Run the transaction body inline instead of against a real Transaction."""

    @staticmethod
    def transactional(fn):
        return fn


def _wire_run(monkeypatch, status, dispatched=False):
    monkeypatch.setattr(sessions, "firestore", _PassThroughFirestore)
    snap = MagicMock(); snap.exists = True
    snap.to_dict.return_value = {"status": status, "dispatched": dispatched}
    ref = MagicMock(); ref.get.return_value = snap
    db = MagicMock()
    monkeypatch.setattr(sessions, "get_firestore", lambda: db)
    monkeypatch.setattr(sessions, "_run_ref", lambda b, c, r: ref)
    return db.transaction.return_value


@pytest.mark.parametrize("status", ["done", "failed", "cancelled"])
def test_terminal_runs_cannot_be_claimed(monkeypatch, status):
    """'cancelled' used to be missing here, so a late deadline task could flip a
    run the lecturer had stopped back to 'running'."""
    txn = _wire_run(monkeypatch, status)
    assert sessions.claim_run_dispatch(batch_id="b1", chat_id="c1", run_id="r1") is False
    txn.update.assert_not_called()


def test_already_dispatched_run_cannot_be_claimed(monkeypatch):
    txn = _wire_run(monkeypatch, "running", dispatched=True)
    assert sessions.claim_run_dispatch(batch_id="b1", chat_id="c1", run_id="r1") is False
    txn.update.assert_not_called()


def test_awaiting_run_is_claimed_once_and_marked_dispatched(monkeypatch):
    txn = _wire_run(monkeypatch, "awaiting_attachments")
    assert sessions.claim_run_dispatch(batch_id="b1", chat_id="c1", run_id="r1") is True
    written = txn.update.call_args.args[1]
    assert written["dispatched"] is True and written["status"] == "running"
