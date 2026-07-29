"""Phase 1 native-first pipeline: hashing, dedup, quota, statuses, manifest."""

import asyncio
import io
from unittest.mock import MagicMock

import pytest

from services.chat_attachment_service import (
    AttachmentValidationError,
    _content_sha256,
    _estimate_document_tokens,
    _find_reusable_duplicate,
    _reserve_chat_storage,
    process_chat_attachment,
)
from services.attachment_constants import (
    IMAGE_TOKEN_ESTIMATE,
    MAX_CHAT_ATTACHMENT_BYTES,
    TOKENS_PER_PDF_PAGE,
)


def _pdf_bytes(pages: int) -> bytes:
    from pypdf import PdfWriter
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=595, height=842)
    buf = io.BytesIO()
    writer.write(buf)
    return b"%PDF-" + buf.getvalue()[5:] if not buf.getvalue().startswith(b"%PDF-") else buf.getvalue()


# ---------------------------------------------------------------------------
# Token estimation
# ---------------------------------------------------------------------------

def test_pdf_token_estimate_uses_page_count():
    data = _pdf_bytes(3)
    assert _estimate_document_tokens(data, "application/pdf", 0) == 3 * TOKENS_PER_PDF_PAGE


def test_text_token_estimate_uses_char_count():
    assert _estimate_document_tokens(b"", "text/plain", 8_000) == 2_000


def test_pdf_token_estimate_falls_back_on_parse_failure():
    estimate = _estimate_document_tokens(b"%PDF-garbage", "application/pdf", 0)
    assert estimate >= TOKENS_PER_PDF_PAGE


# ---------------------------------------------------------------------------
# Dedup by content hash
# ---------------------------------------------------------------------------

def _dup_query(monkeypatch, docs):
    db = MagicMock()
    stream = (
        db.collection.return_value.document.return_value
        .collection.return_value.document.return_value
        .collection.return_value.where.return_value.limit.return_value.stream
    )
    stream.return_value = docs
    monkeypatch.setattr("services.chat_attachment_service.get_firestore", lambda: db)
    return db


def test_dedup_returns_existing_unsent_attachment(monkeypatch):
    doc = MagicMock()
    doc.id = "att-1"
    doc.to_dict.return_value = {
        "lecturer_id": "l1", "scope": "chat", "message_id": None,
        "attachment_kind": "document", "content_type": "application/pdf",
        "file_name": "a.pdf", "batch_id": "b1", "chat_id": "c1",
        "status": "ready", "content_sha256": "abc", "expires_at": None,
    }
    _dup_query(monkeypatch, [doc])
    found = _find_reusable_duplicate("b1", "c1", "l1", "abc")
    assert found is not None and found.attachment_id == "att-1"


def test_dedup_skips_sent_and_foreign_records(monkeypatch):
    sent = MagicMock(); sent.id = "att-sent"
    sent.to_dict.return_value = {"lecturer_id": "l1", "scope": "chat", "message_id": "m1", "expires_at": None}
    foreign = MagicMock(); foreign.id = "att-foreign"
    foreign.to_dict.return_value = {"lecturer_id": "OTHER", "scope": "chat", "message_id": None, "expires_at": None}
    _dup_query(monkeypatch, [sent, foreign])
    assert _find_reusable_duplicate("b1", "c1", "l1", "abc") is None


def test_content_sha256_is_stable():
    assert _content_sha256(b"hello") == _content_sha256(b"hello")
    assert _content_sha256(b"hello") != _content_sha256(b"world")


# ---------------------------------------------------------------------------
# Transactional quota counter
# ---------------------------------------------------------------------------

def _quota_db(monkeypatch, current_bytes):
    db = MagicMock()
    txn = MagicMock()
    txn._max_attempts = 1
    db.transaction.return_value = txn
    chat_ref = (
        db.collection.return_value.document.return_value
        .collection.return_value.document.return_value
    )
    chat_ref.get.return_value.to_dict.return_value = {"attachment_storage_bytes": current_bytes}
    monkeypatch.setattr("services.chat_attachment_service.get_firestore", lambda: db)
    return txn, chat_ref


def test_quota_reservation_rejects_over_limit(monkeypatch):
    _quota_db(monkeypatch, MAX_CHAT_ATTACHMENT_BYTES - 10)
    with pytest.raises(AttachmentValidationError):
        _reserve_chat_storage("b1", "c1", 11)


def test_quota_reservation_increments_counter(monkeypatch):
    txn, _chat_ref = _quota_db(monkeypatch, 100)
    _reserve_chat_storage("b1", "c1", 50)
    assert txn.update.called
    _, kwargs_or_args = txn.update.call_args[0][0], txn.update.call_args[0][1]
    assert txn.update.call_args[0][1] == {"attachment_storage_bytes": 150}


# ---------------------------------------------------------------------------
# Background processing: status transitions
# ---------------------------------------------------------------------------

def _processing_doc(monkeypatch, doc_data, data=b"x"):
    db = MagicMock()
    ref = (
        db.collection.return_value.document.return_value
        .collection.return_value.document.return_value
        .collection.return_value.document.return_value
    )
    snap = ref.get.return_value
    snap.exists = True
    snap.to_dict.return_value = doc_data
    monkeypatch.setattr("services.chat_attachment_service.get_firestore", lambda: db)
    # process_chat_attachment now re-fetches bytes from GCS itself.
    monkeypatch.setattr("services.chat_attachment_service.download_bytes", lambda *a, **k: data)
    return ref


def test_process_text_document_becomes_ready(monkeypatch):
    ref = _processing_doc(monkeypatch, {
        "attachment_kind": "document", "content_type": "text/plain",
        "lecturer_id": "l1", "gcs_path": "gs://b/x.txt", "status": "processing",
    }, data=b"some plain text content here")
    process_chat_attachment("b1", "c1", "att-1")
    updates = ref.update.call_args[0][0]
    assert updates["status"] == "ready"
    assert updates["parse_status"] == "ready"
    assert updates["token_estimate"] >= 1
    assert "extracted_text_path" not in updates  # text/plain is natively readable


def test_process_docx_uploads_extracted_text_blob(monkeypatch):
    ref = _processing_doc(monkeypatch, {
        "attachment_kind": "document",
        "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "lecturer_id": "l1", "gcs_path": "gs://b/x.docx", "status": "processing",
    })
    extraction = MagicMock()
    extraction.text = "docx body text " * 100
    monkeypatch.setattr("services.chat_attachment_service.extract_document", lambda *a, **k: extraction)
    uploaded = {}
    def fake_upload(path, data, content_type="application/octet-stream"):
        uploaded["path"], uploaded["content_type"] = path, content_type
        return f"gs://bucket/{path}"
    monkeypatch.setattr("services.chat_attachment_service.upload_bytes", fake_upload)
    process_chat_attachment("b1", "c1", "att-1")
    updates = ref.update.call_args[0][0]
    assert updates["status"] == "ready"
    assert updates["extracted_text_path"].startswith("gs://")
    assert uploaded["content_type"] == "text/plain"


def test_process_failure_marks_failed(monkeypatch):
    ref = _processing_doc(monkeypatch, {
        "attachment_kind": "document", "content_type": "application/pdf",
        "lecturer_id": "l1", "gcs_path": "gs://b/x.pdf", "status": "processing",
    })
    def boom(*args, **kwargs):
        raise RuntimeError("extraction exploded")
    monkeypatch.setattr("services.chat_attachment_service.extract_document", boom)
    process_chat_attachment("b1", "c1", "att-1")
    updates = ref.update.call_args[0][0]
    assert updates["status"] == "failed"
    assert updates["parse_status"] == "failed"


def test_process_image_sets_token_estimate_and_ready(monkeypatch):
    ref = _processing_doc(monkeypatch, {
        "attachment_kind": "image", "content_type": "image/png",
        "lecturer_id": "l1", "gcs_path": "gs://b/x.png", "status": "processing",
    })
    monkeypatch.setattr("services.chat_attachment_service._thumbnail_bytes", lambda data: b"thumb")
    monkeypatch.setattr("services.chat_attachment_service.upload_bytes", lambda *a, **k: "gs://bucket/thumb.jpg")
    monkeypatch.setattr(
        "services.chat_attachment_service._vision_context",
        lambda *a, **k: ("ready", "summary", "ocr", "", "bytes"),
    )
    process_chat_attachment("b1", "c1", "att-1")
    updates = ref.update.call_args[0][0]
    assert updates["status"] == "ready"
    assert updates["token_estimate"] == IMAGE_TOKEN_ESTIMATE
    assert updates["vision_status"] == "ready"


def test_process_image_vision_failure_still_ready(monkeypatch):
    ref = _processing_doc(monkeypatch, {
        "attachment_kind": "image", "content_type": "image/png",
        "lecturer_id": "l1", "gcs_path": "gs://b/x.png", "status": "processing",
    })
    monkeypatch.setattr("services.chat_attachment_service._thumbnail_bytes", lambda data: b"thumb")
    monkeypatch.setattr("services.chat_attachment_service.upload_bytes", lambda *a, **k: "gs://bucket/thumb.jpg")
    monkeypatch.setattr(
        "services.chat_attachment_service._vision_context",
        lambda *a, **k: ("failed", "", "", "bytes: Boom", "none"),
    )
    process_chat_attachment("b1", "c1", "att-1")
    updates = ref.update.call_args[0][0]
    assert updates["status"] == "ready"  # vision is best-effort on the native path
    assert updates["vision_status"] == "failed"


# ---------------------------------------------------------------------------
# Trusted manifest (gateway)
# ---------------------------------------------------------------------------

def _current_record(**overrides):
    record = {
        "attachment_id": "att-current", "message_id": "m1", "file_name": "current.pdf",
        "file_title": "current.pdf", "attachment_kind": "document",
        "content_type": "application/pdf", "status": "ready",
        "gcs_path": "gs://bucket/l1/current.pdf", "extracted_text_path": None,
        "token_estimate": 774, "expires_at": None,
    }
    record.update(overrides)
    return record


def test_manifest_includes_current_and_retained(monkeypatch):
    from services.agent_gateway import build_chat_attachment_context
    retained = _current_record(
        attachment_id="att-old", file_name="old.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        gcs_path="gs://bucket/l1/old.docx", extracted_text_path="gs://bucket/l1/old-extract.txt",
    )
    monkeypatch.setattr(
        "services.chat_attachment_service.list_live_attachment_docs",
        lambda *a, **k: [retained, _current_record()],  # current dupe must be skipped
    )
    state = build_chat_attachment_context(
        [_current_record()], batch_id="b1", chat_id="c1", lecturer_id="l1",
    )
    manifest = state["current_chat_attachments_manifest"]
    ids = [entry["attachment_id"] for entry in manifest]
    assert ids == ["att-current", "att-old"]
    current, old = manifest[0], manifest[1]
    assert current["is_current_message"] is True and old["is_current_message"] is False
    assert current["gcs_uri"] == "gs://bucket/l1/current.pdf"
    assert current["native_mime_type"] == "application/pdf"
    # DOCX native read points at the derived text artifact
    assert old["gcs_uri"] == "gs://bucket/l1/old-extract.txt"
    assert old["native_mime_type"] == "text/plain"
    assert state["current_chat_attachment_ids"] == ["att-current"]


def test_manifest_native_context_is_summary_lines(monkeypatch):
    from services.agent_gateway import build_chat_attachment_context
    monkeypatch.setenv("CHAT_ATTACHMENT_LEGACY_CONTEXT", "false")
    monkeypatch.setattr(
        "services.chat_attachment_service.list_live_attachment_docs", lambda *a, **k: [],
    )
    state = build_chat_attachment_context(
        [_current_record()], batch_id="b1", chat_id="c1", lecturer_id="l1",
    )
    context = state["current_chat_attachment_context"]
    assert "current.pdf" in context and "774" in context
    assert len(context) < 500  # summary lines, not a 30k text blob
    assert "gs://" not in context  # URIs never rendered into prompt text


def test_manifest_legacy_context_preserved_by_default(monkeypatch):
    from services.agent_gateway import build_chat_attachment_context
    monkeypatch.delenv("CHAT_ATTACHMENT_LEGACY_CONTEXT", raising=False)
    monkeypatch.setattr(
        "services.chat_attachment_service.list_live_attachment_docs", lambda *a, **k: [],
    )
    record = _current_record(extracted_text_preview="PREVIEW TEXT MARKER")
    state = build_chat_attachment_context(
        [record], batch_id="b1", chat_id="c1", lecturer_id="l1",
    )
    assert "PREVIEW TEXT MARKER" in state["current_chat_attachment_context"]


# ---------------------------------------------------------------------------
# Status endpoint payload + delete_blob honesty
# ---------------------------------------------------------------------------

def test_rag_status_endpoint_exposes_native_statuses(monkeypatch):
    from routers.chats import get_chat_attachment_rag_status_endpoint
    from services.chat_attachment_service import attachment_to_model
    attachment = attachment_to_model("att-1", {
        "batch_id": "b1", "chat_id": "c1", "lecturer_id": "l1",
        "attachment_kind": "document", "content_type": "application/pdf",
        "file_name": "x.pdf", "status": "ready", "token_estimate": 516,
    })
    monkeypatch.setattr("routers.chats.get_chat_attachment", lambda *a: attachment)
    payload = asyncio.run(get_chat_attachment_rag_status_endpoint(
        "b1", "c1", "att-1", current_user={"uid": "l1"},
    ))
    for key in ("status", "parse_status", "vision_status", "token_estimate"):
        assert key in payload
    assert payload["status"] == "ready" and payload["token_estimate"] == 516


def test_delete_blob_rejects_malformed_paths():
    from utils.gcs import delete_blob
    assert delete_blob("not-a-gcs-path") is False
    assert delete_blob("gs://bucket-only") is False
