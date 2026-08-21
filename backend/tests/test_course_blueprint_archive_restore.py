"""Archiving a Course Plan must be reversible, and must not renumber history.

The bug this pins down: archiving cleared the batch's current pointer, which removed
the plan from the current card, from chat context and from week prefill all at once,
and the only way back was "Make current" — a *clone* that left an identical pair
(vN archived, vN+1 active) behind. Restore puts the same document back.
"""

import pytest

from services import course_blueprint_service as svc


class _Snap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else {}


class _Ref:
    def __init__(self, store, path):
        self._store, self._path = store, tuple(path)

    @property
    def id(self):
        return self._path[-1]

    def collection(self, name):
        return _Col(self._store, self._path + (name,))

    def get(self, transaction=None):
        return _Snap(self.id, self._store.get(self._path))

    def _update(self, data):
        merged = dict(self._store.get(self._path) or {})
        merged.update(data)
        self._store[self._path] = merged

    def _set(self, data):
        self._store[self._path] = dict(data)

    def _delete(self):
        self._store.pop(self._path, None)


class _Col:
    def __init__(self, store, path):
        self._store, self._path = store, tuple(path)
        self._order = None

    def document(self, doc_id):
        return _Ref(self._store, self._path + (doc_id,))

    def order_by(self, field, direction=None):
        self._order = (field, direction)
        return self

    def stream(self):
        rows = [
            (key, value) for key, value in self._store.items()
            if len(key) == len(self._path) + 1 and key[:len(self._path)] == self._path
        ]
        if self._order:
            field, direction = self._order
            rows.sort(key=lambda kv: kv[1].get(field) or 0, reverse=direction == "DESCENDING")
        return [_Snap(key[-1], value) for key, value in rows]


class _Txn:
    """Applied inline — `_PassThrough.transactional` runs the body directly."""

    def update(self, ref, data):
        ref._update(data)

    def set(self, ref, data):
        ref._set(data)

    def delete(self, ref):
        ref._delete()


class _Db:
    def __init__(self, store):
        self._store = store

    def collection(self, name):
        return _Col(self._store, (name,))

    def transaction(self):
        return _Txn()


class _PassThrough:
    @staticmethod
    def transactional(fn):
        return fn


LECTURER = "u1"
BATCH = "b1"


def _blueprint(blueprint_id, version, status="active", is_current=True):
    return {
        "blueprint_id": blueprint_id, "batch_id": BATCH, "lecturer_id": LECTURER,
        "course_name": "math", "title": f"Plan v{version}", "summary": "S",
        "weekly_plan": [], "assessment_strategy": "", "lab_strategy": "",
        "teaching_preferences": {}, "open_questions": [],
        "status": status, "version": version, "is_current": is_current,
        "supersedes_blueprint_id": "", "superseded_by_blueprint_id": "",
        "content_hash": f"hash{version}",
    }


@pytest.fixture
def store(monkeypatch):
    data = {
        ("batches", BATCH): {
            "lecturer_id": LECTURER, "course_name": "math",
            "current_course_blueprint_id": "bp1", "current_course_blueprint_version": 1,
        },
        ("batches", BATCH, "course_blueprints", "bp1"): _blueprint("bp1", 1),
    }
    monkeypatch.setattr(svc, "firestore", _PassThrough)
    monkeypatch.setattr(svc, "get_firestore", lambda: _Db(data))
    return data


def _batch(store):
    return store[("batches", BATCH)]


def _bp(store, blueprint_id):
    return store[("batches", BATCH, "course_blueprints", blueprint_id)]


def test_archiving_hides_the_plan_without_deleting_it(store):
    svc.archive_current_blueprint(BATCH, LECTURER)
    assert _bp(store, "bp1")["status"] == "archived"
    assert _bp(store, "bp1")["is_current"] is False
    assert _batch(store)["current_course_blueprint_id"] == ""
    assert svc.get_current_blueprint(BATCH, LECTURER) is None
    # Still findable — this is what the page has to surface.
    assert [item["blueprint_id"] for item in svc.list_blueprint_history(BATCH, LECTURER)] == ["bp1"]


def test_archiving_keeps_the_version_counter(store):
    """The counter is a high-water mark. Rewinding it hands the next save a number
    that already exists in history."""
    svc.archive_current_blueprint(BATCH, LECTURER)
    assert _batch(store)["current_course_blueprint_version"] == 1


def test_restore_brings_back_the_same_version_not_a_copy(store):
    svc.archive_current_blueprint(BATCH, LECTURER)
    restored = svc.restore_archived_blueprint(BATCH, LECTURER, "bp1")

    assert restored["blueprint_id"] == "bp1" and restored["version"] == 1
    assert restored["status"] == "active" and restored["is_current"] is True
    assert _batch(store)["current_course_blueprint_id"] == "bp1"
    assert svc.get_current_blueprint(BATCH, LECTURER)["blueprint_id"] == "bp1"
    # The whole point: no vN+1 twin left behind.
    assert len(svc.list_blueprint_history(BATCH, LECTURER)) == 1


def test_restore_supersedes_a_plan_saved_after_the_archive(store):
    svc.archive_current_blueprint(BATCH, LECTURER)
    store[("batches", BATCH, "course_blueprints", "bp2")] = _blueprint("bp2", 2)
    _batch(store).update({
        "current_course_blueprint_id": "bp2", "current_course_blueprint_version": 2,
    })

    svc.restore_archived_blueprint(BATCH, LECTURER, "bp1")

    assert _bp(store, "bp2")["status"] == "superseded"
    assert _bp(store, "bp2")["is_current"] is False
    assert _bp(store, "bp2")["superseded_by_blueprint_id"] == "bp1"
    assert _bp(store, "bp1")["is_current"] is True
    # Restoring v1 must not rewind the counter to 1 and collide with v2 on the next save.
    assert _batch(store)["current_course_blueprint_version"] == 2


def test_restore_refuses_a_version_that_is_not_archived(store):
    with pytest.raises(svc.BlueprintEligibilityError):
        svc.restore_archived_blueprint(BATCH, LECTURER, "bp1")


def test_restore_refuses_another_lecturers_batch(store):
    svc.archive_current_blueprint(BATCH, LECTURER)
    with pytest.raises(svc.BlueprintNotFoundError):
        svc.restore_archived_blueprint(BATCH, "someone-else", "bp1")


def test_restore_refuses_a_missing_version(store):
    with pytest.raises(svc.BlueprintNotFoundError):
        svc.restore_archived_blueprint(BATCH, LECTURER, "nope")


def test_deleting_the_current_version_leaves_the_counter_alone(store):
    """It used to reset to 0, so the next save started again at v1 — beside the v1
    already in history, giving the lecturer two rows both labelled v1."""
    store[("batches", BATCH, "course_blueprints", "bp2")] = _blueprint("bp2", 2)
    _batch(store).update({
        "current_course_blueprint_id": "bp2", "current_course_blueprint_version": 2,
    })

    svc.delete_blueprint_version(BATCH, LECTURER, "bp2")

    assert ("batches", BATCH, "course_blueprints", "bp2") not in store
    assert _batch(store)["current_course_blueprint_id"] == ""
    assert _batch(store)["current_course_blueprint_version"] == 2
