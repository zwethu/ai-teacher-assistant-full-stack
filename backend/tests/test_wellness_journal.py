"""The stress meter records rather than refuses, and the journal writes itself.

Two behaviours are easy to get subtly wrong and are what this file pins down:

  * `at_max` is read *before* the increase. Reading it after would flag the one
    action that pushed someone to the ceiling as if they had ground through it,
    so the first late-night generation would be libelled and the rest counted
    correctly — a report nobody would trust twice.

  * A day is finalised once. Reports are keyed `{uid}_{date}`, so two tabs
    opening the journal at the same moment cannot produce two versions of a
    day, and re-reading never rewrites a day whose rows have since decayed out.
"""

from datetime import datetime, timedelta, timezone

import pytest

from services import wellness_service as ws


class _Doc:
    def __init__(self, doc_id, data, exists=True):
        self.id = doc_id
        self._data = data
        self.exists = exists

    def to_dict(self):
        return dict(self._data)


class _DocRef:
    def __init__(self, store, key):
        self.store = store
        self.key = key

    def get(self):
        data = self.store.get(self.key)
        return _Doc(self.key, data or {}, exists=data is not None)

    def set(self, data):
        self.store[self.key] = dict(data)

    def update(self, data):
        self.store.setdefault(self.key, {}).update(data)


class _Collection:
    def __init__(self, store, auto):
        self.store = store
        self.auto = auto
        self.filters = []

    def document(self, key):
        return _DocRef(self.store, key)

    def add(self, data):
        self.auto[0] += 1
        self.store[f"auto-{self.auto[0]}"] = dict(data)

    def where(self, field, op, value):
        clone = _Collection(self.store, self.auto)
        clone.filters = [*self.filters, (field, op, value)]
        return clone

    def stream(self):
        for key, data in self.store.items():
            if all(data.get(f) == v for f, _, v in self.filters):
                yield _Doc(key, data)


class _Firestore:
    def __init__(self):
        self.data = {}
        self.auto = [0]

    def collection(self, name):
        return _Collection(self.data.setdefault(name, {}), self.auto)


@pytest.fixture()
def db(monkeypatch):
    fake = _Firestore()
    monkeypatch.setattr(ws, "get_firestore", lambda: fake)
    # SERVER_TIMESTAMP is a sentinel in production; here it has to be a real
    # datetime because the roll-up sorts and formats it.
    monkeypatch.setattr(ws, "SERVER_TIMESTAMP", datetime(2026, 8, 18, 16, 40, tzinfo=timezone.utc))
    return fake


def _rows(db):
    return list(db.data.get(ws.ACTIVITY_COLLECTION, {}).values())


def _reports(db):
    return list(db.data.get(ws.DAILY_COLLECTION, {}).values())


# --------------------------------------------------------------------- bands


@pytest.mark.parametrize(
    "score,level",
    [(0, "low"), (39.9, "low"), (40, "medium"), (74.9, "medium"),
     (75, "high"), (94.9, "high"), (95, "max"), (100, "max")],
)
def test_band_floors(score, level):
    assert ws.stress_level(score) == level


# ------------------------------------------------------------- no more block


def test_work_continues_past_the_ceiling(db):
    """The deadline is tomorrow. The meter pins and the work still goes in."""
    db.data.setdefault(ws.STRESS_COLLECTION, {})["u1"] = {
        "stress_score": 100.0,
        "last_active_at": datetime.now(timezone.utc),
        "last_breathing_date": "",
    }

    state = ws.increase_stress("u1", ws.STRESS_LESSON_PLAN, "lesson_plan")

    assert state["stress_score"] == 100.0  # capped, not refused
    assert state["level"] == "max"
    assert len(_rows(db)) == 1
    assert _rows(db)[0]["at_max"] is True


def test_the_action_that_reaches_the_ceiling_is_not_grinding(db):
    """Crossing into max is the cost of one action, not a night of them."""
    db.data.setdefault(ws.STRESS_COLLECTION, {})["u1"] = {
        "stress_score": 80.0,
        "last_active_at": datetime.now(timezone.utc),
        "last_breathing_date": "",
    }

    ws.increase_stress("u1", ws.STRESS_LESSON_PLAN, "lesson_plan")  # 80 -> 100
    ws.increase_stress("u1", ws.STRESS_CHAT_MESSAGE, "chat")        # already pinned

    at_max = [row["at_max"] for row in _rows(db)]
    assert at_max == [False, True]


# ----------------------------------------------------------------- roll-ups


def _seed_day(db, date, rows):
    store = db.data.setdefault(ws.ACTIVITY_COLLECTION, {})
    base = datetime(2026, 8, 17, 12, 0, tzinfo=timezone.utc)
    for index, (action, cost, score_after, at_max) in enumerate(rows):
        store[f"{date}-{index}"] = {
            "uid": "u1",
            "action": action,
            "cost": cost,
            "score_after": score_after,
            "at_max": at_max,
            "local_date": date,
            "created_at": base + timedelta(minutes=index),
        }


def test_a_finished_day_becomes_one_report(db, monkeypatch):
    monkeypatch.setattr(ws, "_local_today", lambda: "2026-08-18")
    _seed_day(db, "2026-08-17", [
        ("lesson_plan", 25.0, 25.0, False),
        ("lesson_plan", 25.0, 50.0, False),
        ("email", 10.0, 60.0, False),
        ("chat", 2.0, 100.0, True),
    ])

    ws.finalize_days("u1")

    assert len(_reports(db)) == 1
    report = _reports(db)[0]
    assert report["date"] == "2026-08-17"
    assert report["actions"] == {"lesson_plan": 2, "email": 1, "chat": 1}
    assert report["total_actions"] == 4
    assert report["stress_added"] == 62.0
    assert report["peak_score"] == 100.0
    assert report["end_score"] == 100.0
    assert report["grind_actions"] == 1
    assert report["grind_from"]  # a local clock time, for the report's sentence


def test_finalizing_twice_writes_one_report(db, monkeypatch):
    monkeypatch.setattr(ws, "_local_today", lambda: "2026-08-18")
    _seed_day(db, "2026-08-17", [("chat", 2.0, 2.0, False)])

    ws.finalize_days("u1")
    ws.finalize_days("u1")

    assert len(_reports(db)) == 1


def test_today_is_reported_live_and_never_stored(db, monkeypatch):
    """The day is not over, so anything written now is wrong by dinner."""
    monkeypatch.setattr(ws, "_local_today", lambda: "2026-08-18")
    monkeypatch.setattr(ws, "_local_now", lambda: datetime(2026, 8, 18, 23, 40))
    _seed_day(db, "2026-08-18", [("lesson_plan", 25.0, 25.0, False)])

    page = ws.list_journal("u1")

    assert _reports(db) == []
    assert page["month"] == "2026-08"
    assert len(page["entries"]) == 1
    assert page["entries"][0]["in_progress"] is True
    assert page["entries"][0]["total_actions"] == 1


def test_journal_returns_one_month_newest_first(db, monkeypatch):
    monkeypatch.setattr(ws, "_local_today", lambda: "2026-08-18")
    monkeypatch.setattr(ws, "_local_now", lambda: datetime(2026, 8, 18, 9, 0))
    _seed_day(db, "2026-08-15", [("chat", 2.0, 2.0, False)])
    _seed_day(db, "2026-08-16", [("email", 10.0, 12.0, False)])
    _seed_day(db, "2026-07-31", [("chat", 2.0, 2.0, False)])

    page = ws.list_journal("u1")

    assert [entry["date"] for entry in page["entries"]] == ["2026-08-16", "2026-08-15"]
    assert [entry["date"] for entry in ws.list_journal("u1", "2026-07")["entries"]] == ["2026-07-31"]
