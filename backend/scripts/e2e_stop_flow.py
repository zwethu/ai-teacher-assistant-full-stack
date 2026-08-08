"""Live end-to-end proof of the stop flow, against the real deployed engine.

Drives the actual FastAPI app (endpoints → gateway → Agent Engine → RTDB →
Firestore) with only Firebase token verification overridden. The measurements
this exists for:

  1. Stop latency — how long after POST /cancel the agent's own RTDB events
     cease. Before the fix the orphan ran its whole workflow (~58s measured
     live); with the backend watcher + the agent's cooperative cancel it should
     be seconds.
  2. Immediate-resend behaviour — the same chip re-invoked right after the
     stop must succeed, either directly or after a visible run.retrying event.

Mechanics note: under TestClient, FastAPI background tasks run inside the
request, so POST /agent/invoke blocks until the whole agent run finishes. The
invoke therefore runs on a worker thread while the main thread watches
Firestore for the run id, sends the cancel, and samples RTDB.

Usage:  .venv/bin/python scripts/e2e_stop_flow.py [--batch BATCH_ID]
Creates a scratch chat in the batch; deletes it at the end.
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: E402  — the app, with its credential resolution
from fastapi.testclient import TestClient  # noqa: E402

from utils import rtdb_client  # noqa: E402
from utils.firebase_auth import get_current_user  # noqa: E402
from utils.firestore_client import get_firestore  # noqa: E402

LECTURER_UID = "qmluZo5ayEY4ZKuaKwFHsIlgHPJ3"
DEFAULT_BATCH = "vqs3E8ooa1VAJOZaGBCU"

STOP_AFTER_SECONDS = 12          # mid tool-phase for a lesson-plan outline
QUIET_WINDOW_SECONDS = 6         # events must cease for this long to count as stopped
STOP_LATENCY_BUDGET = 20         # hard fail if the agent writes events past this


async def fake_user():
    return {"uid": LECTURER_UID, "email": "e2e@test.local"}


def rtdb_events(run_id: str) -> list[dict]:
    from firebase_admin import db as fdb

    assert rtdb_client._ensure_init()
    data = fdb.reference(f"agentRuns/{run_id}/events", app=rtdb_client._rtdb_app).get() or {}
    return sorted(
        (e for e in data.values() if isinstance(e, dict)),
        key=lambda e: e.get("created_at") or 0,
    )


def last_agent_event_ts(run_id: str) -> float | None:
    """Timestamp of the newest event the AGENT wrote (backend events excluded)."""
    agent_events = [e for e in rtdb_events(run_id) if e.get("source") != "backend"]
    if not agent_events:
        return None
    ts = agent_events[-1].get("created_at") or 0
    return float(ts) / 1000 if float(ts) > 1e11 else float(ts)


def invoke_payload(batch_id: str, chat_id: str) -> dict:
    return {
        "batch_id": batch_id,
        "chat_id": chat_id,
        "workflow_type": "lesson_plan.generate",
        "workflow_stage": "outline",
        "pending_artifact": True,
        "save_draft": False,
        "week": 1,
        "message": "E2E stop-flow test: draft a week 1 lesson plan outline.",
        "connectors": {"web_search": False},
        "attachment_ids": [],
    }


def wait_for_new_run(batch_id: str, chat_id: str, seen: set[str], timeout: float = 30) -> str:
    """The invoke response is blocked behind the run; read the run id from the
    chat doc the gateway writes before dispatching."""
    chat_ref = (
        get_firestore()
        .collection("batches").document(batch_id)
        .collection("chats").document(chat_id)
    )
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        active = str((chat_ref.get().to_dict() or {}).get("active_run_id") or "")
        if active and active not in seen:
            return active
        time.sleep(0.5)
    raise TimeoutError("no new active_run_id appeared on the chat")


def run_status(batch_id: str, chat_id: str, run_id: str) -> str:
    doc = (
        get_firestore()
        .collection("batches").document(batch_id)
        .collection("chats").document(chat_id)
        .collection("runs").document(run_id)
        .get().to_dict() or {}
    )
    return str(doc.get("status") or "")


def run(batch_id: str) -> int:
    main.app.dependency_overrides[get_current_user] = fake_user
    report: list[str] = []
    results: dict[str, object] = {}

    with TestClient(main.app) as client:
        created = client.post(f"/batches/{batch_id}/chats", json={"title": "E2E stop test"})
        created.raise_for_status()
        chat_id = created.json()["chat_id"]
        print(f"scratch chat {chat_id}")

        def blocking_invoke(name: str) -> None:
            response = client.post("/agent/invoke", json=invoke_payload(batch_id, chat_id))
            results[name] = (response.status_code, response.json())

        # ---- Run 1: start, then stop mid tool-phase -------------------------
        seen: set[str] = set()
        thread1 = threading.Thread(target=blocking_invoke, args=("run1",), daemon=True)
        thread1.start()
        run1 = wait_for_new_run(batch_id, chat_id, seen)
        seen.add(run1)
        print(f"run1={run1}; stopping in {STOP_AFTER_SECONDS}s")
        time.sleep(STOP_AFTER_SECONDS)

        cancel_at = time.time()
        cancelled = client.post(
            f"/batches/{batch_id}/chats/{chat_id}/runs/{run1}/cancel"
        ).json()
        print(f"cancel -> {cancelled}")

        stopped_at: float | None = None
        while time.time() - cancel_at < STOP_LATENCY_BUDGET + QUIET_WINDOW_SECONDS:
            last_ts = last_agent_event_ts(run1)
            if last_ts is None or time.time() - last_ts >= QUIET_WINDOW_SECONDS:
                stopped_at = last_ts
                break
            time.sleep(1)

        last_delta = None if stopped_at is None else stopped_at - cancel_at
        thread1.join(timeout=60)
        status1 = run_status(batch_id, chat_id, run1)
        if last_delta is None:
            report.append(f"run1: no agent events after cancel at all (status={status1})")
            stop_ok = True
        else:
            report.append(
                f"run1: last agent event {last_delta:+.1f}s after cancel (status={status1})"
            )
            stop_ok = last_delta <= STOP_LATENCY_BUDGET
        report.append(f"run1: settled '{status1}' (expected cancelled)")
        stop_ok = stop_ok and status1 == "cancelled"

        # ---- Run 2: immediate resend ---------------------------------------
        thread2 = threading.Thread(target=blocking_invoke, args=("run2",), daemon=True)
        thread2.start()
        run2 = wait_for_new_run(batch_id, chat_id, seen)
        print(f"run2={run2} (immediate resend); waiting for it to settle")
        thread2.join(timeout=420)
        status2 = run_status(batch_id, chat_id, run2)
        retried = any(e.get("event_type") == "run.retrying" for e in rtdb_events(run2))
        report.append(
            f"run2: settled '{status2}'"
            + (" after a visible run.retrying wait" if retried else " directly, no retry needed")
        )

        # ---- Cleanup --------------------------------------------------------
        deleted = client.delete(f"/batches/{batch_id}/chats/{chat_id}")
        print(f"cleanup: delete chat -> {deleted.status_code}")

    print("\n=== RESULT ===")
    for line in report:
        print(" ", line)
    ok = stop_ok and status2 == "done"
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", default=DEFAULT_BATCH)
    parser.add_argument("--stop-after", type=float, default=STOP_AFTER_SECONDS)
    args = parser.parse_args()
    STOP_AFTER_SECONDS = args.stop_after
    sys.exit(run(args.batch))
