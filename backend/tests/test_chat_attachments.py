import io
import zipfile

import pytest

from services.agent_gateway import build_chat_attachment_context
from services.chat_attachment_service import AttachmentValidationError, validate_attachment


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

