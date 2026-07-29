"""Phase 4 lifecycle: hard TTL (no sliding), unsent grace, reconciliation."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from services.attachment_constants import (
    get_chat_attachment_retention_days,
    get_unsent_attachment_grace_hours,
)


def test_default_ttls():
    assert get_chat_attachment_retention_days() == 30
    assert get_unsent_attachment_grace_hours() == 24


def _cleanup_db(monkeypatch, docs):
    db = MagicMock()
    db.collection_group.return_value.where.return_value.limit.return_value.stream.return_value = docs
    monkeypatch.setattr("services.chat_attachment_service.get_firestore", lambda: db)
    return db


def _expired_doc(doc_id="a1", scope="chat"):
    doc = MagicMock(); doc.id = doc_id
    doc.to_dict.return_value = {"scope": scope, "batch_id": "b1", "chat_id": "c1"}
    return doc


def test_cleanup_is_hard_ttl_no_sliding_extension(monkeypatch):
    """Expired attachments are deleted outright — never re-extended."""
    from services import chat_attachment_service as svc
    _cleanup_db(monkeypatch, [_expired_doc()])
    deleted = []
    monkeypatch.setattr(svc, "delete_attachment_record",
                        lambda b, c, a, *args, **kw: deleted.append(a) or "deleted")
    count = svc.cleanup_expired_attachments()
    assert count == 1 and deleted == ["a1"]


def test_cleanup_skips_non_chat_scope(monkeypatch):
    from services import chat_attachment_service as svc
    _cleanup_db(monkeypatch, [_expired_doc(scope="batch")])
    monkeypatch.setattr(svc, "delete_attachment_record", lambda *a, **k: "deleted")
    assert svc.cleanup_expired_attachments() == 0


def test_create_uses_unsent_grace_ttl(monkeypatch):
    """A freshly uploaded (unsent) attachment expires ~24h out, not 7 days."""
    from services import chat_attachment_service as svc
    monkeypatch.setattr(svc, "validate_attachment", lambda *a: ("x.txt", "text/plain"))
    monkeypatch.setattr(svc, "_content_sha256", lambda d: "hash")
    monkeypatch.setattr(svc, "_find_reusable_duplicate", lambda *a: None)
    monkeypatch.setattr(svc, "_reserve_chat_storage", lambda *a: None)
    monkeypatch.setattr(svc, "upload_bytes", lambda *a, **k: "gs://bucket/x.txt")
    captured = {}
    ref = MagicMock()
    ref.set.side_effect = lambda payload: captured.update(payload)
    ref.get.return_value.to_dict.return_value = {}
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: ref)
    monkeypatch.setattr(svc, "attachment_to_model", lambda *a: MagicMock())
    svc.create_chat_attachment(
        batch_id="b1", chat_id="c1", lecturer_id="l1",
        file_name="x.txt", file_title="", content_type="text/plain", data=b"hi",
    )
    expires = captured["expires_at"]
    delta = expires - datetime.now(timezone.utc)
    assert timedelta(hours=23) < delta < timedelta(hours=25)


def test_reconciliation_dry_run_reports_without_deleting(monkeypatch):
    from services import chat_attachment_service as svc

    doc = MagicMock(); doc.id = "orphan-doc"
    doc.to_dict.return_value = {"scope": "chat", "batch_id": "b1", "chat_id": "c1", "gcs_path": "gs://bucket/gone.txt"}
    db = MagicMock()
    db.collection_group.return_value.limit.return_value.stream.return_value = [doc]
    monkeypatch.setattr(svc, "get_firestore", lambda: db)
    monkeypatch.setattr("utils.gcs.blob_exists", lambda p: False)          # doc's blob is gone
    monkeypatch.setattr("utils.gcs.list_chat_attachment_object_uris",
                        lambda limit=200: [("gs://bucket/lecturers/l1/batches/b1/chats/c1/attachments/orphan-blob/f.png",
                                            ("b1", "c1", "orphan-blob"))])
    missing_snap = MagicMock(); missing_snap.exists = False
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: MagicMock(get=lambda: missing_snap))
    deleted = []
    monkeypatch.setattr(svc, "delete_attachment_record", lambda *a, **k: deleted.append(a) or "deleted")

    result = svc.reconcile_orphaned_attachments(dry_run=True)
    assert result["docs_without_blobs"] == ["orphan-doc"]
    assert result["blobs_without_docs"] == ["gs://bucket/lecturers/l1/batches/b1/chats/c1/attachments/orphan-blob/f.png"]
    assert result["docs_deleted"] == 0 and result["blobs_deleted"] == 0
    assert deleted == []  # dry run touches nothing


def test_reconciliation_enforce_deletes(monkeypatch):
    from services import chat_attachment_service as svc
    doc = MagicMock(); doc.id = "orphan-doc"
    doc.to_dict.return_value = {"scope": "chat", "batch_id": "b1", "chat_id": "c1", "gcs_path": "gs://bucket/gone.txt"}
    db = MagicMock()
    db.collection_group.return_value.limit.return_value.stream.return_value = [doc]
    monkeypatch.setattr(svc, "get_firestore", lambda: db)
    monkeypatch.setattr("utils.gcs.blob_exists", lambda p: False)
    monkeypatch.setattr("utils.gcs.list_chat_attachment_object_uris", lambda limit=200: [])
    monkeypatch.setattr(svc, "delete_attachment_record", lambda *a, **k: "deleted")
    result = svc.reconcile_orphaned_attachments(dry_run=False)
    assert result["docs_deleted"] == 1


def test_list_chat_attachment_object_uris_parses_and_skips_derived():
    from utils import gcs
    blobs = [
        MagicMock(name="lecturers/l1/batches/b1/chats/c1/attachments/a1/file.pdf"),
        MagicMock(name="lecturers/l1/batches/b1/chats/c1/attachments/a1/thumbnail.jpg"),
        MagicMock(name="lecturers/l1/batches/b1/chats/c1/attachments/a2/extracted_text.txt"),
        MagicMock(name="lecturers/l1/batches/b1/chats/c1/attachments/a3/img.png"),
    ]
    # MagicMock(name=...) sets the repr, not .name — assign explicitly.
    names = [
        "lecturers/l1/batches/b1/chats/c1/attachments/a1/file.pdf",
        "lecturers/l1/batches/b1/chats/c1/attachments/a1/thumbnail.jpg",
        "lecturers/l1/batches/b1/chats/c1/attachments/a2/extracted_text.txt",
        "lecturers/l1/batches/b1/chats/c1/attachments/a3/img.png",
    ]
    for blob, name in zip(blobs, names):
        blob.name = name
    client = MagicMock(); client.list_blobs.return_value = blobs
    import unittest.mock as m
    with m.patch.object(gcs, "_get_client", lambda: client), m.patch.object(gcs, "_get_bucket_name", lambda: "bucket"):
        uris = gcs.list_chat_attachment_object_uris()
    ids = sorted(entry[1][2] for entry in uris)
    assert ids == ["a1", "a3"]  # a1 primary kept once, thumbnail skipped, a2 extracted_text skipped
