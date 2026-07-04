"""Backend-authoritative oversize enforcement (hybrid: early 413 + too_large status)."""

import asyncio
from unittest.mock import MagicMock

import pytest

from services import chat_attachment_service as svc
from services.chat_attachment_service import (
    AttachmentTooLargeError,
    AttachmentValidationError,
)
from services.attachment_constants import get_max_native_read_tokens


def test_too_large_is_a_validation_error_subclass():
    # Router relies on catching the subclass before the base.
    assert issubclass(AttachmentTooLargeError, AttachmentValidationError)


def test_default_native_ceiling_is_60k():
    assert get_max_native_read_tokens() == 60_000


def test_pdf_over_limit_rejected_at_upload_before_storage(monkeypatch):
    """A too-large PDF fails fast — never reserves quota or hits storage."""
    monkeypatch.setattr(svc, "validate_attachment", lambda *a: ("big.pdf", "application/pdf"))
    monkeypatch.setattr(svc, "_estimate_document_tokens", lambda *a, **k: 90_000)
    reserved = MagicMock()
    monkeypatch.setattr(svc, "_reserve_chat_storage", reserved)
    uploaded = MagicMock()
    monkeypatch.setattr(svc, "upload_bytes", uploaded)
    with pytest.raises(AttachmentTooLargeError):
        svc.create_chat_attachment(
            batch_id="b1", chat_id="c1", lecturer_id="l1",
            file_name="big.pdf", file_title="", content_type="application/pdf", data=b"%PDF-x",
        )
    reserved.assert_not_called()
    uploaded.assert_not_called()


def test_pdf_under_limit_passes_upload(monkeypatch):
    monkeypatch.setattr(svc, "validate_attachment", lambda *a: ("ok.pdf", "application/pdf"))
    monkeypatch.setattr(svc, "_estimate_document_tokens", lambda *a, **k: 5_000)
    monkeypatch.setattr(svc, "_find_reusable_duplicate", lambda *a: None)
    monkeypatch.setattr(svc, "_reserve_chat_storage", lambda *a: None)
    monkeypatch.setattr(svc, "upload_bytes", lambda *a, **k: "gs://bucket/ok.pdf")
    ref = MagicMock(); ref.get.return_value.to_dict.return_value = {}
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: ref)
    monkeypatch.setattr(svc, "attachment_to_model", lambda *a: MagicMock(status="processing"))
    result = svc.create_chat_attachment(
        batch_id="b1", chat_id="c1", lecturer_id="l1",
        file_name="ok.pdf", file_title="", content_type="application/pdf", data=b"%PDF-x",
    )
    assert result.status == "processing"


def test_office_over_limit_flips_to_too_large_status(monkeypatch):
    """DOCX can't be sized at upload — it flips to too_large after extraction."""
    ref = MagicMock()
    snap = ref.get.return_value
    snap.exists = True
    snap.to_dict.return_value = {
        "attachment_kind": "document",
        "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "lecturer_id": "l1", "gcs_path": "gs://b/x.docx", "status": "processing",
    }
    monkeypatch.setattr(svc, "get_firestore", lambda: MagicMock())
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: ref)
    extraction = MagicMock(); extraction.text = "huge document body"
    monkeypatch.setattr(svc, "extract_document", lambda *a, **k: extraction)
    monkeypatch.setattr(svc, "upload_bytes", lambda *a, **k: "gs://b/extracted.txt")
    monkeypatch.setattr(svc, "_estimate_document_tokens", lambda *a, **k: 250_000)
    svc.process_chat_attachment("b1", "c1", "att-1", b"PK-docx")
    updates = ref.update.call_args[0][0]
    assert updates["status"] == "too_large"
    assert updates["token_estimate"] == 250_000


def test_office_under_limit_is_ready(monkeypatch):
    ref = MagicMock()
    snap = ref.get.return_value; snap.exists = True
    snap.to_dict.return_value = {
        "attachment_kind": "document",
        "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "lecturer_id": "l1", "gcs_path": "gs://b/x.docx", "status": "processing",
    }
    monkeypatch.setattr(svc, "get_firestore", lambda: MagicMock())
    monkeypatch.setattr(svc, "attachment_ref", lambda *a: ref)
    extraction = MagicMock(); extraction.text = "small doc"
    monkeypatch.setattr(svc, "extract_document", lambda *a, **k: extraction)
    monkeypatch.setattr(svc, "upload_bytes", lambda *a, **k: "gs://b/extracted.txt")
    monkeypatch.setattr(svc, "_estimate_document_tokens", lambda *a, **k: 3_000)
    svc.process_chat_attachment("b1", "c1", "att-1", b"PK-docx")
    assert ref.update.call_args[0][0]["status"] == "ready"


def test_router_maps_too_large_to_413(monkeypatch):
    from routers import chats as chats_router
    from fastapi import HTTPException

    monkeypatch.setattr(chats_router, "get_chat", lambda *a, **k: {"chat_id": "c1"})

    def boom(**kwargs):
        raise AttachmentTooLargeError("This file is too large to use in chat.")

    monkeypatch.setattr(chats_router, "create_chat_attachment", boom)

    class _UploadFile:
        filename = "big.pdf"; content_type = "application/pdf"
        async def read(self): return b"%PDF-x"

    with pytest.raises(HTTPException) as exc:
        asyncio.run(chats_router.upload_chat_attachment_endpoint(
            "b1", "c1", MagicMock(), file=_UploadFile(), file_title="",
            current_user={"uid": "l1"},
        ))
    assert exc.value.status_code == 413
