"""`list_chats(limit=N)` returns N chats the lecturer can see, not N documents.

Every generation run leaves a hidden workspace chat behind, so on a busy batch
the hidden chats outnumber the real ones. The hidden filter cannot be a
Firestore query — it has to match documents written before the `hidden` field
existed — so it runs in Python, and applying it after `.limit()` made a page of
30 come back as 12. A client paging until it got fewer than it asked for read
that as the end of the list and lost every older chat.
"""

from datetime import datetime, timedelta, timezone

import pytest

from services import chat_service as cs

BASE = datetime(2026, 7, 1, tzinfo=timezone.utc)


class _Doc:
    def __init__(self, doc_id: str, data: dict):
        self.id = doc_id
        self.data = data

    def to_dict(self):
        return dict(self.data)


class _Query:
    """Enough of a Firestore query to model where/order_by/limit/stream."""

    def __init__(self, docs, size=None):
        self.docs = docs
        self.size = size

    def where(self, field, op, value):
        if field == "created_at" and op == "<":
            return _Query([d for d in self.docs if d.data["created_at"] < value], self.size)
        return _Query(self.docs, self.size)  # lecturer_id: the fixture is already scoped

    def order_by(self, field, direction=None):
        return _Query(sorted(self.docs, key=lambda d: d.data["created_at"], reverse=True), self.size)

    def limit(self, size):
        return _Query(self.docs, size)

    def stream(self):
        return iter(self.docs[: self.size] if self.size else self.docs)


def _install(monkeypatch, docs):
    monkeypatch.setattr(cs, "_chats_col", lambda batch_id: _Query(docs))


def _chat(index: int, *, hidden: bool = False, title: str = "Real chat"):
    """Newest-first ordering follows the index: 0 is the newest."""
    return _Doc(
        f"c{index}",
        {
            "lecturer_id": "lect-1",
            "title": title,
            "type": "chat",
            "hidden": hidden,
            "created_at": BASE - timedelta(minutes=index),
        },
    )


def test_a_full_page_survives_a_run_of_hidden_chats(monkeypatch):
    # 25 workspaces, then 5 real chats. The old code read the newest 3
    # documents, filtered all three away and returned nothing at all.
    docs = [_chat(i, hidden=True) for i in range(25)] + [_chat(i) for i in range(25, 30)]
    _install(monkeypatch, docs)

    chats = cs.list_chats("b1", "lect-1", limit=3)

    assert [c["chat_id"] for c in chats] == ["c25", "c26", "c27"]


def test_short_page_only_when_the_list_really_ends(monkeypatch):
    docs = [_chat(i, hidden=True) for i in range(10)] + [_chat(10), _chat(11)]
    _install(monkeypatch, docs)

    assert len(cs.list_chats("b1", "lect-1", limit=30)) == 2


def test_the_cursor_walks_backwards_through_the_list(monkeypatch):
    docs = [_chat(i) for i in range(6)]
    _install(monkeypatch, docs)

    first = cs.list_chats("b1", "lect-1", limit=2)
    second = cs.list_chats("b1", "lect-1", limit=2, before=first[-1]["created_at"])

    assert [c["chat_id"] for c in first] == ["c0", "c1"]
    assert [c["chat_id"] for c in second] == ["c2", "c3"]


def test_paging_reaches_every_visible_chat(monkeypatch):
    # Interleaved, so no page boundary lines up with the filter.
    docs = [_chat(i, hidden=(i % 3 != 0)) for i in range(30)]
    _install(monkeypatch, docs)

    seen, cursor = [], None
    while True:
        page = cs.list_chats("b1", "lect-1", limit=2, before=cursor)
        if not page:
            break
        seen += [c["chat_id"] for c in page]
        cursor = page[-1]["created_at"]

    assert seen == [f"c{i}" for i in range(0, 30, 3)]


@pytest.mark.parametrize("title", ["Generation workspace"])
def test_legacy_workspaces_without_the_flag_are_still_excluded(monkeypatch, title):
    docs = [_chat(0, title=title), _chat(1)]
    _install(monkeypatch, docs)

    assert [c["chat_id"] for c in cs.list_chats("b1", "lect-1", limit=5)] == ["c1"]


def test_include_hidden_keeps_them(monkeypatch):
    docs = [_chat(0, hidden=True), _chat(1)]
    _install(monkeypatch, docs)

    assert len(cs.list_chats("b1", "lect-1", include_hidden=True, limit=5)) == 2
