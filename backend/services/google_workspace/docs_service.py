"""Google Docs service — creates lesson plan and lab documents for users.

Uses user OAuth credentials to create docs in the user's own Drive.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from services.google_workspace.credentials import build_user_credentials
from services.google_workspace.docs_rendering.builder import DocBuilder
from services.google_workspace.docs_rendering.lab_builder import LabDocBuilder
from services.google_workspace.docs_rendering.renderer import render_phases
from services.google_workspace.docs_rendering.schemas import (
    LabFull,
    LessonPlanFull,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# URL / ID helpers
# ---------------------------------------------------------------------------

def extract_doc_id(doc_url: str) -> str:
    """Extract Google Doc ID from URL."""
    match = re.search(r"/document/d/([a-zA-Z0-9_-]+)", doc_url)
    if not match:
        raise ValueError(f"Cannot extract doc ID from URL: {doc_url}")
    return match.group(1)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_docs_service(uid: str):
    creds = build_user_credentials(uid, ["documents", "drive.file"])
    return build("docs", "v1", credentials=creds, cache_discovery=False)


def _build_drive_service(uid: str):
    creds = build_user_credentials(uid, ["drive.file"])
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _clear_doc(docs_service, doc_id: str) -> None:
    document = docs_service.documents().get(documentId=doc_id).execute()
    end_index = 1
    for element in document.get("body", {}).get("content", []):
        if "endIndex" in element:
            end_index = max(end_index, element["endIndex"])
    if end_index > 2:
        docs_service.documents().batchUpdate(
            documentId=doc_id,
            body={
                "requests": [
                    {
                        "deleteContentRange": {
                            "range": {"startIndex": 1, "endIndex": end_index - 1}
                        }
                    }
                ]
            },
        ).execute()


def _share_doc_with_teacher(drive_service, doc_id: str, lecturer_email: str) -> None:
    drive_service.permissions().create(
        fileId=doc_id,
        body={
            "type": "user",
            "role": "writer",
            "emailAddress": lecturer_email,
        },
        sendNotificationEmail=False,
    ).execute()


def _table_start_indices(document: dict[str, Any]) -> list[int]:
    return [
        element["startIndex"]
        for element in document.get("body", {}).get("content", [])
        if "table" in element
    ]


def _planned_table_starts(requests: list[dict[str, Any]]) -> list[int]:
    return [
        req["insertTable"]["location"]["index"]
        for req in requests
        if "insertTable" in req
    ]


def _remap_table_style_starts(
    style_requests: list[dict[str, Any]],
    start_map: dict[int, int],
) -> None:
    for req in style_requests:
        cell_style = req.get("updateTableCellStyle")
        if not cell_style:
            continue
        location = cell_style["tableRange"]["tableCellLocation"]["tableStartLocation"]
        planned = location["index"]
        location["index"] = start_map.get(planned, planned)


def _apply_blocks(docs_service, doc_id: str, requests: list[dict[str, Any]]) -> None:
    if not requests:
        return
    docs_service.documents().batchUpdate(
        documentId=doc_id,
        body={"requests": requests},
    ).execute()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_lesson_plan_doc_for_user(
    uid: str,
    lesson_plan_payload: dict[str, Any],
    lecturer_email: str,
    existing_doc_id: str | None = None,
) -> dict[str, str]:
    """Create a styled lesson plan Google Doc for the user.

    Returns ``{"doc_url": "...", "doc_id": "...", "title": "..."}``.
    """
    plan = LessonPlanFull.model_validate(lesson_plan_payload)
    blocks = DocBuilder(plan).build()

    docs = _build_docs_service(uid)
    drive = _build_drive_service(uid)

    try:
        if existing_doc_id:
            doc_id = existing_doc_id
            _clear_doc(docs, doc_id)
            drive.files().update(
                fileId=doc_id,
                body={"name": plan.title},
            ).execute()
        else:
            document = docs.documents().create(
                body={"title": plan.title}
            ).execute()
            doc_id = document["documentId"]

        content_requests, style_requests = render_phases(blocks)
        logger.info(
            "applying lesson plan doc uid=%s week=%s content=%d style=%d",
            uid, plan.week, len(content_requests), len(style_requests),
        )
        _apply_blocks(docs, doc_id, content_requests)

        if style_requests:
            document = docs.documents().get(documentId=doc_id).execute()
            planned = _planned_table_starts(content_requests)
            actual = _table_start_indices(document)
            if planned and actual and len(planned) == len(actual):
                start_map = dict(zip(planned, actual, strict=True))
                _remap_table_style_starts(style_requests, start_map)
            elif planned:
                logger.warning(
                    "table count mismatch planned=%d actual=%d",
                    len(planned), len(actual),
                )
            _apply_blocks(docs, doc_id, style_requests)

        _share_doc_with_teacher(drive, doc_id, lecturer_email)
    except HttpError as exc:
        logger.exception("Google Docs API error for uid=%s week=%s", uid, plan.week)
        raise RuntimeError(
            f"Failed to create lesson plan doc '{plan.title}': {exc}"
        ) from exc

    doc_url = f"https://docs.google.com/document/d/{doc_id}/edit"
    logger.info("created lesson plan doc uid=%s week=%s url=%s", uid, plan.week, doc_url)
    return {"doc_url": doc_url, "doc_id": doc_id, "title": plan.title}


def create_lab_docs_for_user(
    uid: str,
    lab_payload: dict[str, Any],
    lecturer_email: str,
) -> dict[str, str]:
    """Create lecturer guide + student instructions Google Docs.

    Returns ``{"lecturer_doc_url", "lecturer_doc_id",
    "student_doc_url", "student_doc_id"}``.
    """
    lab = LabFull.model_validate(lab_payload)
    docs = _build_docs_service(uid)
    drive = _build_drive_service(uid)
    result: dict[str, str] = {}

    for mode in ("lecturer", "student"):
        if mode == "lecturer":
            doc_title = f"Week {lab.week} Lab — {lab.title} (Lecturer Guide)"
        else:
            doc_title = f"Week {lab.week} Lab — {lab.title} (Student Instructions)"

        blocks = LabDocBuilder(lab, mode=mode).build()  # type: ignore[arg-type]

        try:
            document = docs.documents().create(body={"title": doc_title}).execute()
            doc_id = document["documentId"]

            content_requests, style_requests = render_phases(blocks)
            logger.info(
                "applying lab doc uid=%s week=%s mode=%s content=%d style=%d",
                uid, lab.week, mode, len(content_requests), len(style_requests),
            )
            _apply_blocks(docs, doc_id, content_requests)

            if style_requests:
                document = docs.documents().get(documentId=doc_id).execute()
                planned = _planned_table_starts(content_requests)
                actual = _table_start_indices(document)
                if planned and actual and len(planned) == len(actual):
                    start_map = dict(zip(planned, actual, strict=True))
                    _remap_table_style_starts(style_requests, start_map)
                elif planned:
                    logger.warning(
                        "table count mismatch planned=%d actual=%d", len(planned), len(actual),
                    )
                _apply_blocks(docs, doc_id, style_requests)

            _share_doc_with_teacher(drive, doc_id, lecturer_email)
        except HttpError as exc:
            logger.exception(
                "Google Docs API error for uid=%s week=%s mode=%s", uid, lab.week, mode,
            )
            raise RuntimeError(
                f"Failed to create lab doc '{doc_title}': {exc}"
            ) from exc

        doc_url = f"https://docs.google.com/document/d/{doc_id}/edit"
        logger.info("created lab doc uid=%s week=%s mode=%s url=%s", uid, lab.week, mode, doc_url)
        result[f"{mode}_doc_url"] = doc_url
        result[f"{mode}_doc_id"] = doc_id

    return result

import io
from googleapiclient.http import MediaIoBaseDownload

def export_doc_as_pdf_for_user(uid: str, doc_id: str) -> bytes:
    """Export a Google Doc as PDF bytes using Drive API."""
    drive = _build_drive_service(uid)
    try:
        request = drive.files().export_media(
            fileId=doc_id,
            mimeType="application/pdf",
        )
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buffer.getvalue()
    except HttpError as exc:
        raise RuntimeError(f"Failed to export Google Doc '{doc_id}' as PDF: {exc}") from exc


def read_doc_content_for_user(uid: str, doc_id: str) -> str:
    """Read plain text from all paragraphs in a Google Doc."""
    docs = _build_docs_service(uid)
    try:
        document = docs.documents().get(documentId=doc_id).execute()
    except HttpError as exc:
        raise RuntimeError(f"Failed to read Google Doc '{doc_id}': {exc}") from exc

    paragraphs: list[str] = []
    for element in document.get("body", {}).get("content", []):
        paragraph = element.get("paragraph")
        if not paragraph:
            continue
        parts: list[str] = []
        for elem in paragraph.get("elements", []):
            text_run = elem.get("textRun")
            if text_run and text_run.get("content"):
                parts.append(text_run["content"])
        if parts:
            paragraphs.append("".join(parts))

    return "".join(paragraphs).strip()


def _paragraph_text(paragraph: dict[str, Any]) -> str:
    parts: list[str] = []
    for elem in paragraph.get("elements", []):
        text_run = elem.get("textRun")
        if text_run and text_run.get("content"):
            parts.append(text_run["content"])
    return "".join(parts)


def _collect_links_from_paragraph(paragraph: dict[str, Any], links: list[str]) -> None:
    for elem in paragraph.get("elements", []):
        text_run = elem.get("textRun")
        if not text_run:
            continue
        link = (text_run.get("textStyle") or {}).get("link") or {}
        url = link.get("url")
        if url and url not in links:
            links.append(url)


def _cell_text(cell: dict[str, Any]) -> str:
    parts: list[str] = []
    for element in cell.get("content", []):
        paragraph = element.get("paragraph")
        if paragraph:
            text = _paragraph_text(paragraph).strip()
            if text:
                parts.append(text)
    return " ".join(parts).strip()


def read_doc_structured_for_user(uid: str, doc_id: str) -> dict[str, Any]:
    """Read structured content from a Google Doc (paragraphs, headings, tables, links)."""
    docs = _build_docs_service(uid)
    try:
        document = docs.documents().get(documentId=doc_id).execute()
    except HttpError as exc:
        raise RuntimeError(f"Failed to read Google Doc '{doc_id}': {exc}") from exc

    paragraphs: list[str] = []
    headings: list[str] = []
    tables: list[list[list[str]]] = []
    links: list[str] = []

    for element in document.get("body", {}).get("content", []):
        paragraph = element.get("paragraph")
        if paragraph:
            text = _paragraph_text(paragraph).strip()
            if text:
                paragraphs.append(text)
            named_style = (paragraph.get("paragraphStyle") or {}).get("namedStyleType", "")
            if named_style in {"HEADING_1", "HEADING_2", "HEADING_3"} and text:
                headings.append(text)
            _collect_links_from_paragraph(paragraph, links)
            continue

        table = element.get("table")
        if not table:
            continue

        table_rows: list[list[str]] = []
        for row in table.get("tableRows", []):
            row_cells: list[str] = []
            for cell in row.get("tableCells", []):
                row_cells.append(_cell_text(cell))
                for cell_element in cell.get("content", []):
                    cell_paragraph = cell_element.get("paragraph")
                    if cell_paragraph:
                        _collect_links_from_paragraph(cell_paragraph, links)
            table_rows.append(row_cells)
        tables.append(table_rows)

    return {
        "title": document.get("title", ""),
        "plain_text": "\n".join(paragraphs).strip(),
        "headings": headings,
        "paragraphs": paragraphs,
        "tables": tables,
        "links": links,
    }
