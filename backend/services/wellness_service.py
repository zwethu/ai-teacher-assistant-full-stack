"""Stress meter service — calculation, passive decay, breathing reduction, journal.

The server is the source of truth for the stress score: feature endpoints add
stress after a successful action, the guard blocks them at 100, and the client
only reads state, reports rapid clicking, and triggers breathing/journal.

Stored in Firestore:
  user_stress/{uid}: stress_score, last_active_at, last_breathing_date
  wellness_journal/{auto}: uid, mood, notes, entry_type, stress_score,
                           stress_reduced, created_at
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP

from utils.firestore_client import get_firestore

MAX_STRESS = 100.0
WARNING_THRESHOLD = 80.0
BREATHING_REDUCTION = 20.0
PASSIVE_DECAY_PER_HOUR = 5.0
USER_TIMEZONE_OFFSET_HOURS = 7  # UTC+7, matches localToday() on the frontend

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
JOURNAL_COLLECTION = "wellness_journal"


def workflow_stress_cost(workflow_type: str | None) -> float:
    """Cost of one /agent/invoke by workflow family; plain chat costs 2."""
    family = (workflow_type or "").split(".")[0]
    if family in {"lesson_plan", "lab"}:
        return STRESS_LESSON_PLAN
    if family in {"assessment", "quiz", "game", "course_blueprint"}:
        return STRESS_ARTIFACT
    return STRESS_CHAT_MESSAGE


def _local_today() -> str:
    """Today's date (YYYY-MM-DD) in the user's local timezone (UTC+7)."""
    local_now = datetime.now(timezone.utc) + timedelta(hours=USER_TIMEZONE_OFFSET_HOURS)
    return local_now.strftime("%Y-%m-%d")


def _is_blocked(score: float) -> bool:
    """True at max stress; aligns with the UI showing 100 when it rounds to 100."""
    return float(score) >= 99.5


def _apply_passive_decay(score: float, last_active_at: Any) -> float:
    """Reduce stress by 5 points per hour since last activity."""
    if not isinstance(last_active_at, datetime):
        return score
    now = datetime.now(timezone.utc)
    last = last_active_at if last_active_at.tzinfo else last_active_at.replace(tzinfo=timezone.utc)
    hours_inactive = max(0.0, (now - last).total_seconds() / 3600)
    return max(0.0, score - hours_inactive * PASSIVE_DECAY_PER_HOUR)


def _state_dict(score: float, breathing_used_today: bool, journaled_today: bool) -> dict:
    return {
        "stress_score": round(score, 2),
        "warning": score >= WARNING_THRESHOLD and not _is_blocked(score),
        "blocked": _is_blocked(score),
        "breathing_used_today": breathing_used_today,
        "journaled_today": journaled_today,
    }


def _journal_entries(uid: str) -> list[dict]:
    """All journal rows for a user, newest first.

    Sorted in Python rather than with orderBy: entries accrue at most a couple
    per day, and an equality-only query needs no composite index.
    """
    db = get_firestore()
    docs = db.collection(JOURNAL_COLLECTION).where("uid", "==", uid).stream()
    rows = []
    for doc in docs:
        data = doc.to_dict() or {}
        created = data.get("created_at")
        rows.append({
            "id": doc.id,
            "uid": data.get("uid") or uid,
            "mood": data.get("mood") or "",
            "notes": data.get("notes") or "",
            "entry_type": data.get("entry_type") or "after_breathing",
            "stress_score": float(data.get("stress_score") or 0),
            "stress_reduced": bool(data.get("stress_reduced")),
            "created_at": created.isoformat() if isinstance(created, datetime) else None,
            "_sort": created if isinstance(created, datetime) else datetime.min.replace(tzinfo=timezone.utc),
        })
    rows.sort(key=lambda r: r["_sort"], reverse=True)
    for row in rows:
        row.pop("_sort", None)
    return rows


def _journaled_today(entries: list[dict]) -> bool:
    today = _local_today()
    for entry in entries:
        created = entry.get("created_at")
        if not created:
            continue
        try:
            local = datetime.fromisoformat(created) + timedelta(hours=USER_TIMEZONE_OFFSET_HOURS)
        except ValueError:
            continue
        if local.strftime("%Y-%m-%d") == today:
            return True
    return False


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
        return _state_dict(0.0, False, _journaled_today(_journal_entries(uid)))

    data = snap.to_dict() or {}
    stored = float(data.get("stress_score") or 0)
    decayed = _apply_passive_decay(stored, data.get("last_active_at"))
    if abs(decayed - stored) >= 0.1:
        # Persist the decayed value; last_active_at stays put so the remaining
        # fraction of an hour keeps decaying on the next read.
        ref.update({"stress_score": round(decayed, 2)})

    breathing_used_today = (data.get("last_breathing_date") or "") == _local_today()
    journaled_today = _journaled_today(_journal_entries(uid))
    return _state_dict(decayed, breathing_used_today, journaled_today)


def increase_stress(uid: str, amount: float) -> dict:
    """Add stress points (capped at 100) and mark the user active."""
    state = get_stress_state(uid)
    new_score = min(MAX_STRESS, state["stress_score"] + float(amount))
    db = get_firestore()
    db.collection(STRESS_COLLECTION).document(uid).update({
        "stress_score": round(new_score, 2),
        "last_active_at": SERVER_TIMESTAMP,
    })
    return _state_dict(new_score, state["breathing_used_today"], state["journaled_today"])


def apply_feature_stress(uid: str | None, amount: float) -> None:
    """Charge stress after a successful feature action; never fail the request."""
    if not uid:
        return
    try:
        increase_stress(uid, amount)
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
            "prompt_reflection": False,
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
        **_state_dict(new_score, True, state["journaled_today"]),
        "stress_reduced": True,
        "prompt_reflection": not state["journaled_today"],
        "message": f"Breathing complete! Your stress dropped by {BREATHING_REDUCTION:.0f} points.",
    }


def list_journal(uid: str, limit: int = 20) -> list[dict]:
    return _journal_entries(uid)[: max(1, min(limit, 100))]


def save_journal(uid: str, mood: str, notes: str) -> dict:
    """Save a post-breathing reflection (one per day)."""
    entries = _journal_entries(uid)
    if _journaled_today(entries):
        return {"ok": False, "reason": "already_journaled_today"}

    state = get_stress_state(uid)
    db = get_firestore()
    db.collection(JOURNAL_COLLECTION).add({
        "uid": uid,
        "mood": mood,
        "notes": notes,
        "entry_type": "after_breathing",
        "stress_score": state["stress_score"],
        "stress_reduced": True,
        "created_at": SERVER_TIMESTAMP,
    })
    return {"ok": True}
