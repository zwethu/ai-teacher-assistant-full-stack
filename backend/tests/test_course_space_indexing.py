"""Phase C: file cap, Cloud Tasks indexing chain, native pending manifest."""

from unittest.mock import MagicMock

import pytest

from services import file_service as fs


# --- per-batch file cap ---------------------------------------------------------

def test_default_course_space_cap_is_50():
    assert fs.get_course_space_max_files() == 50


def test_cap_env_override_clamped(monkeypatch):
    monkeypatch.setenv("COURSE_SPACE_MAX_FILES", "0")
    assert fs.get_course_space_max_files() == 1
    monkeypatch.setenv("COURSE_SPACE_MAX_FILES", "200")
    assert fs.get_course_space_max_files() == 200


# --- indexing task chain --------------------------------------------------------

def test_index_file_task_fires_import_and_chains_check(monkeypatch):
    file_ref = MagicMock()
    monkeypatch.setattr(fs, "_file_ref", lambda *a: file_ref)
    monkeypatch.setattr(fs, "_claim_recovery", lambda *a, **k: True)
    monkeypatch.setattr(fs, "_release_recovery", lambda *a, **k: None)
    monkeypatch.setattr(fs, "start_ingest_file", lambda **k: "doc-abc")
    enqueued = []
    monkeypatch.setattr(fs, "enqueue", lambda q, path, payload, **k: enqueued.append((path, payload, k)))
    fs.run_index_file_task("f1", "b1", "gs://b/x.pdf", "l1", "x.pdf")
    # import fired, doc id stored, check-indexing enqueued with a delay
    assert any(p == "/tasks/check-indexing" for p, _pl, _k in enqueued)
    delayed = [k for p, _pl, k in enqueued if p == "/tasks/check-indexing"][0]
    assert delayed.get("delay_seconds", 0) > 0


def test_index_file_task_noop_when_lease_unclaimed(monkeypatch):
    monkeypatch.setattr(fs, "_claim_recovery", lambda *a, **k: False)
    started = MagicMock()
    monkeypatch.setattr(fs, "start_ingest_file", started)
    fs.run_index_file_task("f1", "b1", "gs://b/x.pdf", "l1", "x.pdf")
    started.assert_not_called()


def test_check_indexing_stops_when_visible(monkeypatch):
    snap = MagicMock(); snap.exists = True
    snap.to_dict.return_value = {"index_status": "indexing"}
    ref = MagicMock(); ref.get.return_value = snap
    monkeypatch.setattr(fs, "_file_ref", lambda *a: ref)
    monkeypatch.setattr(fs, "_reconcile_visibility", lambda *a: True)  # became visible
    enqueued = []
    monkeypatch.setattr(fs, "enqueue", lambda *a, **k: enqueued.append(a))
    fs.run_check_indexing_task("f1", "b1", "l1", attempt=0)
    assert enqueued == []  # no re-enqueue once indexed


def test_check_indexing_reenqueues_until_ceiling(monkeypatch):
    snap = MagicMock(); snap.exists = True
    snap.to_dict.return_value = {"index_status": "indexing"}
    ref = MagicMock(); ref.get.return_value = snap
    monkeypatch.setattr(fs, "_file_ref", lambda *a: ref)
    monkeypatch.setattr(fs, "_reconcile_visibility", lambda *a: False)  # not visible yet
    enqueued = []
    monkeypatch.setattr(fs, "enqueue", lambda q, path, payload, **k: enqueued.append(payload))
    fs.run_check_indexing_task("f1", "b1", "l1", attempt=0)
    assert enqueued and enqueued[0]["attempt"] == 1
    # at the ceiling it stops re-enqueuing
    enqueued.clear()
    fs.run_check_indexing_task("f1", "b1", "l1", attempt=fs._CHECK_INDEXING_MAX_ATTEMPTS - 1)
    assert enqueued == []


# --- native pending manifest ----------------------------------------------------

def test_pending_manifest_includes_only_native_ready(monkeypatch):
    docs = []
    for fid, data in [
        ("f1", {"file_id": "f1", "lecturer_id": "l1", "status": "ready", "native_eligible": True,
                "native_gcs_uri": "gs://b/f1.pdf", "native_mime_type": "application/pdf",
                "token_estimate": 500, "file_title": "F1"}),
        ("f2", {"file_id": "f2", "lecturer_id": "l1", "status": "ready", "native_eligible": False,
                "native_gcs_uri": "", "file_title": "F2"}),  # oversized/docx -> excluded
        ("f3", {"file_id": "f3", "lecturer_id": "OTHER", "status": "ready", "native_eligible": True,
                "native_gcs_uri": "gs://b/f3.pdf", "file_title": "F3"}),  # foreign -> excluded
    ]:
        d = MagicMock(); d.id = fid; d.to_dict.return_value = data
        docs.append(d)
    db = MagicMock()
    db.collection.return_value.document.return_value.collection.return_value.stream.return_value = docs
    monkeypatch.setattr(fs, "get_firestore", lambda: db)
    manifest = fs.build_pending_course_materials_manifest("b1", "l1")
    assert [m["file_id"] for m in manifest] == ["f1"]
    assert manifest[0]["native_gcs_uri"] == "gs://b/f1.pdf"


def test_native_eligible_pdf_skips_chunks(monkeypatch):
    """A small PDF becomes native-eligible: pending record has native fields, no chunks."""
    file_ref = MagicMock(); resource_ref = MagicMock()
    monkeypatch.setattr(fs, "_file_ref", lambda *a: file_ref)
    monkeypatch.setattr(fs, "_pending_ref", lambda *a: resource_ref)
    extraction = MagicMock(); extraction.text = "short course text"
    monkeypatch.setattr("services.document_extraction.extract_document", lambda *a, **k: extraction)
    chunk_called = MagicMock()
    monkeypatch.setattr("services.document_extraction.chunk_extraction", chunk_called)
    monkeypatch.setattr(fs, "_course_token_estimate", lambda *a: 500)
    resource_ref.collection.return_value.where.return_value.stream.return_value = []
    fs.build_pending_overlay("f1", "b1", "l1", "x.pdf", "X", "application/pdf", "gs://b/x.pdf", b"%PDF-x")
    payload = resource_ref.set.call_args[0][0]
    assert payload["native_eligible"] is True
    assert payload["native_gcs_uri"] == "gs://b/x.pdf"
    assert payload["chunk_count"] == 0
    chunk_called.assert_not_called()  # native-eligible -> no lexical chunks
