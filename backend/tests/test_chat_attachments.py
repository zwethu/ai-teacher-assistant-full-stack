import io
import zipfile

import pytest
from unittest.mock import MagicMock

from services.agent_gateway import build_chat_attachment_context
from services.chat_attachment_service import (
    AttachmentValidationError,
    _agent_safe_attachment,
    _vision_context,
    validate_attachment,
    validate_batch_document,
)
from services.document_extraction import ExtractionResult, ExtractedSegment, chunk_extraction, extract_document


def _ooxml(required: str) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr(required, "<root />")
    return output.getvalue()


def test_validation_accepts_supported_text_and_ooxml() -> None:
    assert validate_attachment("notes.md", "text/plain", b"hello")[1] == "text/markdown"
    assert validate_attachment(
        "lesson.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ooxml("word/document.xml"),
    )[1].endswith("wordprocessingml.document")


def test_validation_rejects_signature_and_ooxml_type_mismatch() -> None:
    with pytest.raises(AttachmentValidationError, match="PDF signature"):
        validate_attachment("notes.pdf", "application/pdf", b"not a pdf")
    with pytest.raises(AttachmentValidationError, match="wrong type"):
        validate_attachment(
            "slides.pptx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            _ooxml("word/document.xml"),
        )


def test_batch_validation_rejects_legacy_doc_and_accepts_json() -> None:
    with pytest.raises(AttachmentValidationError):
        validate_batch_document("legacy.doc", "application/msword", b"doc", 50 * 1024 * 1024)
    assert validate_batch_document("data.json", "application/json", b'{"ok": true}', 50 * 1024 * 1024)[1] == "application/json"


def test_agent_context_is_bounded_and_marks_images_chat_only() -> None:
    records = [{
        "attachment_id": "a1", "file_name": "board.png", "attachment_kind": "image",
        "content_type": "image/png", "vision_summary": "x" * 40_000,
        "ocr_text": "board text", "parse_status": "skipped", "vision_status": "ready",
    }]
    result = build_chat_attachment_context(records)
    context = result["current_chat_attachment_context"]
    assert len(context) <= 30_000
    assert "chat-only" in context
    assert "cannot be promoted" in context
    assert result["current_chat_attachments_manifest"][0]["chat_only"] is True


def test_failed_image_context_explicitly_prevents_guessing() -> None:
    result = build_chat_attachment_context([{
        "attachment_id": "a2", "file_name": "unknown.png", "attachment_kind": "image",
        "content_type": "image/png", "vision_status": "failed",
    }])
    assert "Do not infer image content" in result["current_chat_attachment_context"]


def test_shared_extraction_and_chunking_are_bounded() -> None:
    extracted = extract_document(("paragraph " * 50_000).encode(), "text/plain", 300_000)
    chunks, truncated = chunk_extraction(extracted, max_chunks=3)
    assert len(chunks) == 3
    assert all(len(chunk.text) <= 5000 for chunk in chunks)
    assert truncated is True


def test_vision_uses_bytes_first(monkeypatch) -> None:
    monkeypatch.setenv("ATTACHMENT_VISION_MODEL", "gemini-test")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "project")
    response = MagicMock(text='{"vision_summary":"board","ocr_text":"week 1"}')
    client = MagicMock(); client.models.generate_content.return_value = response
    monkeypatch.setattr("google.genai.Client", lambda **kwargs: client)
    result = _vision_context(b"image", "gs://bucket/image.png", "image/png")
    assert result[:3] == ("ready", "board", "week 1")
    assert result[4] == "bytes"


def test_vision_falls_back_to_gcs(monkeypatch) -> None:
    monkeypatch.setenv("ATTACHMENT_VISION_MODEL", "gemini-test")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "project")
    response = MagicMock(text='{"vision_summary":"fallback","ocr_text":""}')
    client = MagicMock(); client.models.generate_content.side_effect = [RuntimeError("bytes failed"), response]
    monkeypatch.setattr("google.genai.Client", lambda **kwargs: client)
    result = _vision_context(b"image", "gs://bucket/image.png", "image/png")
    assert result[0] == "ready" and result[1] == "fallback" and result[4] == "gcs_uri"


def test_same_chat_dto_excludes_storage_and_internal_errors() -> None:
    safe = _agent_safe_attachment("a1", {
        "file_name": "notes.pdf", "content_type": "application/pdf",
        "attachment_kind": "document", "size_bytes": 42,
        "gcs_path": "gs://private/original", "thumbnail_gcs_path": "gs://private/thumb",
        "vision_error": "secret provider failure", "extracted_text_path": "gs://private/text",
        "extracted_text_preview": "bounded context",
    }, include_context=False)
    assert safe["size_bytes"] == 42
    assert "extracted_text_preview" not in safe
    assert not ({"gcs_path", "thumbnail_gcs_path", "extracted_text_path", "vision_error"} & safe.keys())


def test_attachment_search_route_precedes_dynamic_attachment_route() -> None:
    from routers.chats import router

    paths = [route.path for route in router.routes]
    search_index = next(index for index, path in enumerate(paths) if path.endswith("/{chat_id}/attachments/search"))
    dynamic_index = next(index for index, path in enumerate(paths) if path.endswith("/{chat_id}/attachments/{attachment_id}"))
    assert search_index < dynamic_index
