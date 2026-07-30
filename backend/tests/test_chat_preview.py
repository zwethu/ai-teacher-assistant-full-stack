"""Denormalised chat subtitle, and the messages read cap.

Both exist to stop the chat list and the messages endpoint from reading whole
message collections — the list used to fetch every message of every chat just to
render a one-line preview.
"""

from unittest.mock import MagicMock

import pytest


class _PassThroughFirestore:
    """Stand-in for the `firestore` module so the transaction body runs inline.

    `@firestore.transactional` is applied inside add_user_message_with_attachments
    on every call, so replacing the module attribute is enough to unwrap it.
    """

    @staticmethod
    def transactional(fn):
        return fn

    class Query:
        DESCENDING = "DESCENDING"


def _commit_message(monkeypatch, *, existing_preview=None, content="Plan me a week 3 lab"):
    """Run one user-message commit and return the chat-doc update it produced."""
    from services import chat_service as cs

    monkeypatch.setattr(cs, "firestore", _PassThroughFirestore)

    chat_data = {"lecturer_id": "lect-1"}
    if existing_preview is not None:
        chat_data["preview"] = existing_preview
    chat_snap = MagicMock(); chat_snap.exists = True
    chat_snap.to_dict.return_value = chat_data

    db = MagicMock()
    chat_ref = db.collection.return_value.document.return_value.collection.return_value.document.return_value
    chat_ref.get.return_value = chat_snap
    monkeypatch.setattr(cs, "get_firestore", lambda: db)

    txn = db.transaction.return_value
    cs.add_user_message_with_attachments(
        batch_id="batch-1", chat_id="chat-1", content=content,
        lecturer_id="lect-1", run_id="run-1", attachment_ids=[],
    )
    # No attachments, so the only txn.update is the chat doc.
    assert txn.update.call_count == 1
    return txn.update.call_args.args[1]


def test_preview_written_on_first_user_message(monkeypatch):
    updates = _commit_message(monkeypatch)
    assert updates["preview"] == "Plan me a week 3 lab"


def test_preview_not_overwritten_by_later_messages(monkeypatch):
    """It is the chat's opening request, not its most recent one."""
    updates = _commit_message(monkeypatch, existing_preview="the original question")
    assert "preview" not in updates
    assert "updated_at" in updates


def test_preview_truncated_and_skipped_when_blank(monkeypatch):
    from services.chat_service import PREVIEW_MAX_CHARS

    updates = _commit_message(monkeypatch, content="x" * 500)
    assert len(updates["preview"]) == PREVIEW_MAX_CHARS

    # An attachment-only message carries no text worth showing as a subtitle.
    assert "preview" not in _commit_message(monkeypatch, content="   ")


def test_chat_without_preview_serialises_to_empty_string():
    """Chats created before the field existed must not break the list; the frontend
    falls back to the title rather than us backfilling every old chat."""
    from services.chat_service import _chat_to_dict

    assert _chat_to_dict("chat-1", {"lecturer_id": "lect-1"})["preview"] == ""


@pytest.fixture
def _messages(monkeypatch):
    from services import chat_service as cs

    monkeypatch.setattr(cs, "get_chat", lambda *a, **kw: {"chat_id": "chat-1"})
    monkeypatch.setattr(cs, "firestore", _PassThroughFirestore)

    def _doc(n):
        doc = MagicMock(); doc.id = f"m{n}"
        doc.to_dict.return_value = {"role": "user", "content": str(n)}
        return doc

    col = MagicMock()
    monkeypatch.setattr(cs, "_messages_col", lambda b, c: col)
    return cs, col, _doc


def test_limit_returns_newest_n_in_chronological_order(_messages):
    cs, col, _doc = _messages
    # Firestore hands them back newest-first under a DESCENDING order_by.
    col.order_by.return_value.limit.return_value.stream.return_value = [_doc(5), _doc(4), _doc(3)]

    result = cs.list_messages("batch-1", "chat-1", "lect-1", limit=3)

    assert [m["content"] for m in result] == ["3", "4", "5"]
    col.order_by.assert_called_with("created_at", direction="DESCENDING")
    col.order_by.return_value.limit.assert_called_with(3)


def test_export_path_stays_unlimited(_messages):
    """render_chat_markdown needs the whole conversation, so no limit is applied."""
    cs, col, _doc = _messages
    col.order_by.return_value.stream.return_value = [_doc(1), _doc(2)]

    result = cs.list_messages("batch-1", "chat-1", "lect-1")

    assert [m["content"] for m in result] == ["1", "2"]
    col.order_by.return_value.limit.assert_not_called()
