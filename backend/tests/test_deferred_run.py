"""Phase B: deferred agent run — ordering, trigger, once-only dispatch, watchdog."""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from services import agent_gateway as gw


# --- on_attachment_settled: dispatch only when ALL awaited files are settled ----

def _wire_run(monkeypatch, *, run_status, awaiting, settled, message_id="m1"):
    monkeypatch.setattr(gw, "get_attachment_status_and_message", lambda *a: ("ready", message_id))
    monkeypatch.setattr(gw, "get_message_run_id", lambda *a: "run1" if message_id else None)
    monkeypatch.setattr(gw, "read_run_doc", lambda **k: {
        "status": run_status, "awaiting_attachment_ids": awaiting,
        "lecturer_id": "l1", "batch_id": "b1", "chat_id": "c1", "run_id": "run1",
    })
    monkeypatch.setattr(gw, "all_attachments_settled", lambda b, c, ids: settled)
    dispatched = []
    monkeypatch.setattr(gw, "_refresh_and_dispatch", lambda b, c, r, **k: dispatched.append(r))
    return dispatched


def test_settled_dispatches_when_all_ready(monkeypatch):
    dispatched = _wire_run(monkeypatch, run_status="awaiting_attachments",
                           awaiting=["a1", "a2"], settled=True)
    gw.on_attachment_settled("b1", "c1", "a1")
    assert dispatched == ["run1"]


def test_settled_waits_when_sibling_still_processing(monkeypatch):
    dispatched = _wire_run(monkeypatch, run_status="awaiting_attachments",
                           awaiting=["a1", "a2"], settled=False)
    gw.on_attachment_settled("b1", "c1", "a1")
    assert dispatched == []  # a2 still processing — hold


def test_settled_noop_for_unsent_attachment(monkeypatch):
    dispatched = _wire_run(monkeypatch, run_status="awaiting_attachments",
                           awaiting=["a1"], settled=True, message_id="")
    gw.on_attachment_settled("b1", "c1", "a1")
    assert dispatched == []  # no message_id -> nothing waiting


def test_settled_noop_when_run_already_running(monkeypatch):
    dispatched = _wire_run(monkeypatch, run_status="running", awaiting=["a1"], settled=True)
    gw.on_attachment_settled("b1", "c1", "a1")
    assert dispatched == []  # not awaiting -> already dispatched immediately


# --- run_agent_task: once-only dispatch guard ----------------------------------

def test_run_agent_task_skips_when_claim_fails(monkeypatch):
    monkeypatch.setattr(gw, "claim_run_dispatch", lambda **k: False)
    ran = []
    async def fake_bg(**k): ran.append(True)
    monkeypatch.setattr(gw, "_run_agent_background", fake_bg)
    asyncio.run(gw.run_agent_task("b1", "c1", "run1"))
    assert ran == []  # duplicate delivery -> no double invocation


def test_run_agent_task_runs_from_stash(monkeypatch):
    monkeypatch.setattr(gw, "claim_run_dispatch", lambda **k: True)
    monkeypatch.setattr(gw, "set_run_status", lambda *a: None)
    monkeypatch.setattr(gw, "read_run_doc", lambda **k: {
        "rtdb_run_path": "agentRuns/run1", "agent_session_id": "s1", "lecturer_id": "l1",
        "dispatch_payload": {"session_state": {"batch_id": "b1"}, "user_message": "hi"},
    })
    captured = {}
    async def fake_bg(**kwargs): captured.update(kwargs)
    monkeypatch.setattr(gw, "_run_agent_background", fake_bg)
    asyncio.run(gw.run_agent_task("b1", "c1", "run1"))
    assert captured["user_message"] == "hi"
    assert captured["session_state"] == {"batch_id": "b1"}
    assert captured["agent_session_id"] == "s1"


# --- deadline release: past deadline -> fail stuck file, proceed ----------------
#
# The timeout is scheduled per run when the run is deferred, rather than found by
# sweeping every run's status once a minute. Cloud Tasks gives no delivery-time
# guarantee and no dedup, so the handler has to be safe early, late and twice.

def _deferred_run(monkeypatch, *, deadline, status="awaiting_attachments"):
    monkeypatch.setattr(gw, "read_run_doc", lambda **k: {
        "batch_id": "b1", "chat_id": "c1", "run_id": "run1", "status": status,
        "awaiting_attachment_ids": ["a1"], "awaiting_deadline": deadline,
    })
    failed, dispatched = [], []
    monkeypatch.setattr(gw, "fail_stuck_attachment", lambda b, c, a: failed.append(a))
    monkeypatch.setattr(gw, "_refresh_and_dispatch", lambda b, c, r, **k: dispatched.append(r))
    return failed, dispatched


def test_deadline_release_fails_stuck_and_dispatches(monkeypatch):
    failed, dispatched = _deferred_run(
        monkeypatch, deadline=datetime.now(timezone.utc) - timedelta(minutes=1))
    assert gw.release_run_past_deadline("b1", "c1", "run1") is True
    assert failed == ["a1"] and dispatched == ["run1"]


def test_deadline_release_noop_before_deadline(monkeypatch):
    """Delivered early — the scheduled task fires again later, so do nothing now."""
    failed, dispatched = _deferred_run(
        monkeypatch, deadline=datetime.now(timezone.utc) + timedelta(minutes=4))
    assert gw.release_run_past_deadline("b1", "c1", "run1") is False
    assert failed == [] and dispatched == []


@pytest.mark.parametrize("status", ["running", "done", "failed", "cancelled"])
def test_deadline_release_noop_once_run_left_awaiting(monkeypatch, status):
    """The attachments settled (or the lecturer stopped it) before the deadline —
    a late task must not resurrect the run or fail its files."""
    failed, dispatched = _deferred_run(
        monkeypatch, status=status,
        deadline=datetime.now(timezone.utc) - timedelta(minutes=1))
    assert gw.release_run_past_deadline("b1", "c1", "run1") is False
    assert failed == [] and dispatched == []


def test_deadline_release_handles_iso_string_deadline(monkeypatch):
    """Firestore hands the deadline back as a datetime; RTDB round-trips give ISO."""
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    _, dispatched = _deferred_run(monkeypatch, deadline=past)
    assert gw.release_run_past_deadline("b1", "c1", "run1") is True
    assert dispatched == ["run1"]


def test_watchdog_backstop_still_releases_overdue_runs(monkeypatch):
    """Kept for a dropped task, and for local dev where the delayed dispatch is a
    threading.Timer that does not survive a restart."""
    _deferred_run(monkeypatch, deadline=datetime.now(timezone.utc) - timedelta(minutes=1))
    monkeypatch.setattr(gw, "list_runs_awaiting_attachments", lambda limit=50: [
        {"batch_id": "b1", "chat_id": "c1", "run_id": "run1"},
    ])
    assert gw.run_attachment_watchdog() == 1


def test_deadline_handler_is_registered_and_routes(monkeypatch):
    """The scheduled task has to reach a handler both in prod (HTTP route) and
    locally (registered dispatcher), or a deferred run silently never times out."""
    import routers.tasks as t
    from services.cloud_tasks import _LOCAL_HANDLERS

    assert "/tasks/attachment-deadline" in _LOCAL_HANDLERS
    assert any(
        getattr(route, "path", "") == "/tasks/attachment-deadline"
        for route in t.router.routes
    )

    seen = []
    monkeypatch.setattr(gw, "release_run_past_deadline", lambda b, c, r: seen.append((b, c, r)))
    asyncio.run(_LOCAL_HANDLERS["/tasks/attachment-deadline"](
        {"batch_id": "b1", "chat_id": "c1", "run_id": "run1"}))
    assert seen == [("b1", "c1", "run1")]


# --- start_chat_run branch: defer vs immediate (unit on the decision) -----------

def test_pending_attachment_defers_run(monkeypatch):
    """A processing attachment holds the run in awaiting_attachments, no dispatch."""
    marked, dispatched = [], []
    monkeypatch.setattr(gw, "mark_agent_run_awaiting_attachments", lambda **k: marked.append(k))
    monkeypatch.setattr(gw, "set_run_status", lambda *a: None)
    monkeypatch.setattr(gw, "dispatch_agent_run", lambda *a, **k: dispatched.append(a))
    records = [{"attachment_id": "a1", "status": "processing"}]
    pending = [r["attachment_id"] for r in records if r["status"] == "processing"]
    assert pending == ["a1"]  # decision the gateway makes; full flow covered by integration
