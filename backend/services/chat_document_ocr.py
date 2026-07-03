"""Optional low-text PDF OCR enrichment for chat files."""
from __future__ import annotations

import os


def ocr_enabled() -> bool:
    return os.getenv("CHAT_FILE_OCR_ENABLED", "false").lower() == "true"


def should_run_ocr(content_type: str, extracted_text: str, page_count: int | None = None) -> bool:
    if content_type != "application/pdf":
        return False
    chars = len(str(extracted_text or "").strip())
    return chars < 500 or bool(page_count and chars / max(page_count, 1) < 100)


def extract_pdf_with_document_ai(data: bytes) -> str:
    processor = (os.getenv("DOCUMENT_AI_OCR_PROCESSOR_NAME") or "").strip()
    if not ocr_enabled() or not processor:
        raise RuntimeError("Document AI OCR is not configured.")
    from google.cloud import documentai

    client = documentai.DocumentProcessorServiceClient()
    request = documentai.ProcessRequest(
        name=processor,
        raw_document=documentai.RawDocument(content=data, mime_type="application/pdf"),
    )
    return str(client.process_document(request=request).document.text or "")
