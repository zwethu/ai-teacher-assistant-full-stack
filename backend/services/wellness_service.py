"""Stress meter service — calculation, passive decay, breathing, activity journal.

The server is the source of truth for the stress score: feature endpoints add
stress after a successful action and the client only reads state, reports rapid
clicking, and triggers breathing.

Nothing here blocks a feature. A lecturer with a deadline tomorrow works
through the night; the meter's job is to tell them what that is costing, not to
lock the door. Working while the meter is pinned is recorded rather than
refused, and shows up in the day's journal as grinding.

The journal is written, not typed. Every charged action lands in an activity
row; once a day is over, those rows are rolled up into one report for that day.
The lecturer reads it — there is no mood picker and no notes box.

Stored in Firestore:
  user_stress/{uid}:      stress_score, last_active_at, last_breathing_date
  wellness_activity/{id}: uid, action, cost, score_after, at_max, local_date,
                          created_at
  wellness_daily/{uid_date}: uid, date, actions{}, total_actions, stress_added,
                          peak_score, end_score, breathing_done, grind_actions
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP

from utils.firestore_client import get_firestore

MAX_STRESS = 100.0
BREATHING_REDUCTION = 20.0
PASSIVE_DECAY_PER_HOUR = 5.0
USER_TIMEZONE_OFFSET_HOURS = 7  # UTC+7, matches localToday() on the frontend

# Band floors. Four bands rather than three: "high" and "pinned at the ceiling"
# are different situations for the person reading the meter, and only the
# second one counts as grinding.
BAND_MEDIUM = 40.0
BAND_HIGH = 75.0
BAND_MAX = 95.0

# The only client-reported increase is rapid clicking (+5); clamp so a
# malicious client cannot self-inflict more than that per call.
MAX_CLIENT_INCREASE = 5.0

# Feature costs, applied server-side after the action succeeds.
STRESS_LESSON_PLAN = 25.0     # lesson_plan / lab generation
STRESS_ARTIFACT = 15.0        # assessment / quiz / game / course blueprint
STRESS_BATCH_CREATE = 20.0
STRESS_EMAIL = 10.0           # send / draft / schedule
STRESS_CHAT_MESSAGE = 2.0

STRESS_COLLECTION = "user_stress"
ACTIVITY_COLLECTION = "wellness_activity"
DAILY_COLLECTION = "wellness_daily"

# What an activity row's `action` may be, and how to say it in a report. The
# journal is read by a lecturer, not by a developer, so the label is a plain
# noun rather than the endpoint's name for itself.
ACTION_LABELS: dict[str, str] = {
    "lesson_plan": "lesson plans and labs",
    "artifact": "assessments, games and blueprints",
    "batch_create": "batches created",
    "email": "emails drafted or sent",
    "chat": "chat messages",
    "rapid_click": "bursts of rapid clicking",
}


def workflow_stress_cost(workflow_type: str | None) -> float:
    """Cost of one /agent/invoke by workflow family; plain chat costs 2."""
    family = (workflow_type or "").split(".")[0]
    if family in {"lesson_plan", "lab"}:
        return STRESS_LESSON_PLAN
    if family in {"assessment", "quiz", "game", "course_blueprint"}:
        return STRESS_ARTIFACT
    return STRESS_CHAT_MESSAGE


def workflow_action(workflow_type: str | None) -> str:
    """Which activity bucket one /agent/invoke belongs to."""
    family = (workflow_type or "").split(".")[0]
    if family in {"lesson_plan", "lab"}:
        return "lesson_plan"
    if family in {"assessment", "quiz", "game", "course_blueprint"}:
        return "artifact"
    return "chat"


def stress_level(score: float) -> str:
    """Which band a score falls in: low | medium | high | max."""
    if score >= BAND_MAX:
        return "max"
    if score >= BAND_HIGH:
        return "high"
    if score >= BAND_MEDIUM:
        return "medium"
    return "low"


def _local_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=USER_TIMEZONE_OFFSET_HOURS)


def _local_today() -> str:
    """Today's date (YYYY-MM-DD) in the user's local timezone (UTC+7)."""
    return _local_now().strftime("%Y-%m-%d")


def _apply_passive_decay(score: float, last_active_at: Any) -> float:
    """Reduce stress by 5 points per hour since last activity."""
    if not isinstance(last_active_at, datetime):
        return score
    now = datetime.now(timezone.utc)
    last = last_active_at if last_active_at.tzinfo else last_active_at.replace(tzinfo=timezone.utc)
    hours_inactive = max(0.0, (now - last).total_seconds() / 3600)
    return max(0.0, score - hours_inactive * PASSIVE_DECAY_PER_HOUR)


def _state_dict(score: float, breathing_used_today: bool) -> dict:
    return {
        "stress_score": round(score, 2),
        "level": stress_level(score),
        "breathing_used_today": breathing_used_today,
    }


def get_stress_state(uid: str) -> dict:
    """Current stress state with passive decay applied (and persisted if it drifted)."""
    db = get_firestore()
    ref = db.collection(STRESS_COLLECTION).document(uid)
    snap = ref.get()

    if not snap.exists:
        ref.set({
            "stress_score": 0.0,
            "last_active_at": SERVER_TIMESTAMP,
            "last_breathing_date": "",
        })
        return _state_dict(0.0, False)

    data = snap.to_dict() or {}
    stored = float(data.get("stress_score") or 0)
    decayed = _apply_passive_decay(stored, data.get("last_active_at"))
    if abs(decayed - stored) >= 0.1:
        # Persist the decayed value; last_active_at stays put so the remaining
        # fraction of an hour keeps decaying on the next read.
        ref.update({"stress_score": round(decayed, 2)})

    breathing_used_today = (data.get("last_breathing_date") or "") == _local_today()
    return _state_dict(decayed, breathing_used_today)


def increase_stress(uid: str, amount: float, action: str = "chat") -> dict:
    """Add stress points (capped at 100), mark the user active, log the action.

    `at_max` is read *before* the increase: it answers "was this person already
    pinned when they did this?", which is the thing the journal calls grinding.
    Reading it after would flag the single action that took them to the ceiling
    as if they had worked through it.
    """
    state = get_stress_state(uid)
    was_at_max = state["stress_score"] >= BAND_MAX
    new_score = min(MAX_STRESS, state["stress_score"] + float(amount))

    db = get_firestore()
    db.collection(STRESS_COLLECTION).document(uid).update({
        "stress_score": round(new_score, 2),
        "last_active_at": SERVER_TIMESTAMP,
    })
    db.collection(ACTIVITY_COLLECTION).add({
        "uid": uid,
        "action": action,
        "cost": float(amount),
        "score_after": round(new_score, 2),
        "at_max": was_at_max,
        "local_date": _local_today(),
        "created_at": SERVER_TIMESTAMP,
    })
    return _state_dict(new_score, state["breathing_used_today"])


def apply_feature_stress(uid: str | None, amount: float, action: str = "chat") -> None:
    """Charge stress after a successful feature action; never fail the request."""
    if not uid:
        return
    try:
        increase_stress(uid, amount, action)
    except Exception:  # pragma: no cover - defensive
        import logging

        logging.getLogger(__name__).exception("Failed to apply stress for uid=%s", uid)


def complete_breathing(uid: str) -> dict:
    """Log a finished breathing exercise. First one per day reduces stress by 20."""
    state = get_stress_state(uid)

    if state["breathing_used_today"]:
        return {
            **state,
            "stress_reduced": False,
            "message": (
                "Great job completing your breathing exercise! You've already "
                "used your stress reduction for today — come back tomorrow."
            ),
        }

    new_score = max(0.0, state["stress_score"] - BREATHING_REDUCTION)
    db = get_firestore()
    db.collection(STRESS_COLLECTION).document(uid).update({
        "stress_score": round(new_score, 2),
        "last_breathing_date": _local_today(),
    })
    return {
        **_state_dict(new_score, True),
        "stress_reduced": True,
        "message": f"Breathing complete! Your stress dropped by {BREATHING_REDUCTION:.0f} points.",
    }


# --------------------------------------------------------------------------
# The journal: activity rows in, one report per finished day out.
# --------------------------------------------------------------------------


def _activity_rows(uid: str) -> list[dict]:
    """Every activity row for a user.

    Equality on `uid` only, sorted and bucketed in Python: adding a range or an
    order to the query would need a composite index for a collection that holds
    a few rows per person per day.
    """
    db = get_firestore()
    docs = db.collection(ACTIVITY_COLLECTION).where("uid", "==", uid).stream()
    rows = []
    for doc in docs:
        data = doc.to_dict() or {}
        created = data.get("created_at")
        rows.append({
            "action": data.get("action") or "chat",
            "cost": float(data.get("cost") or 0),
            "score_after": float(data.get("score_after") or 0),
            "at_max": bool(data.get("at_max")),
            "local_date": data.get("local_date") or "",
            "created_at": created if isinstance(created, datetime) else None,
        })
    rows.sort(key=lambda r: r["created_at"] or datetime.min.replace(tzinfo=timezone.utc))
    return rows


def _summarise(uid: str, date: str, rows: list[dict], breathing_done: bool) -> dict:
    """Roll one day's activity rows into the report that gets stored."""
    actions: dict[str, int] = {}
    for row in rows:
        actions[row["action"]] = actions.get(row["action"], 0) + 1

    grind_rows = [row for row in rows if row["at_max"]]
    first_grind = grind_rows[0]["created_at"] if grind_rows else None

    return {
        "uid": uid,
        "date": date,
        "actions": actions,
        "total_actions": len(rows),
        "stress_added": round(sum(row["cost"] for row in rows), 2),
        "peak_score": round(max((row["score_after"] for row in rows), default=0.0), 2),
        "end_score": round(rows[-1]["score_after"], 2) if rows else 0.0,
        "breathing_done": breathing_done,
        "grind_actions": len(grind_rows),
        # Local clock time the grinding started, for a report line that reads
        # like a sentence: "kept working from 23:40".
        "grind_from": (
            (first_grind + timedelta(hours=USER_TIMEZONE_OFFSET_HOURS)).strftime("%H:%M")
            if first_grind
            else ""
        ),
    }


def finalize_days(uid: str) -> None:
    """Write a report for every finished day that does not have one yet.

    Called on read rather than by a scheduler: the report only has to exist by
    the time somebody looks at it, and this needs no cron, no service account
    and no fan-out over every user in the system. Writing is idempotent — the
    document id is `{uid}_{date}` — so two tabs racing produce one report.
    """
    today = _local_today()
    rows = [row for row in _activity_rows(uid) if row["local_date"] and row["local_date"] < today]
    if not rows:
        return

    by_date: dict[str, list[dict]] = {}
    for row in rows:
        by_date.setdefault(row["local_date"], []).append(row)

    db = get_firestore()
    breathing_date = ""
    snap = db.collection(STRESS_COLLECTION).document(uid).get()
    if snap.exists:
        breathing_date = (snap.to_dict() or {}).get("last_breathing_date") or ""

    for date, day_rows in by_date.items():
        ref = db.collection(DAILY_COLLECTION).document(f"{uid}_{date}")
        if ref.get().exists:
            continue
        ref.set({
            **_summarise(uid, date, day_rows, breathing_done=breathing_date == date),
            "created_at": SERVER_TIMESTAMP,
        })


def list_journal(uid: str, month: str | None = None) -> dict:
    """One month of daily reports, newest first, plus today's so-far.

    Today is summarised live and never stored: the day is not over, so anything
    written now would be wrong by dinner.
    """
    finalize_days(uid)

    target = month or _local_now().strftime("%Y-%m")
    db = get_firestore()
    docs = db.collection(DAILY_COLLECTION).where("uid", "==", uid).stream()

    entries = []
    for doc in docs:
        data = doc.to_dict() or {}
        date = data.get("date") or ""
        if not date.startswith(target):
            continue
        data.pop("created_at", None)
        entries.append({**data, "date": date, "in_progress": False})
    entries.sort(key=lambda e: e["date"], reverse=True)

    today = _local_today()
    if today.startswith(target):
        rows = [row for row in _activity_rows(uid) if row["local_date"] == today]
        if rows:
            state = get_stress_state(uid)
            entries.insert(0, {
                **_summarise(uid, today, rows, breathing_done=state["breathing_used_today"]),
                "in_progress": True,
            })

    return {"month": target, "entries": entries}
