"""Render DocBuilder blocks into Google Docs batchUpdate requests.

Copied from Pnai-ai/pnai/tools/google_docs/renderer.py with imports
adjusted to use local modules.
"""

from __future__ import annotations

from typing import Any

from services.google_workspace.docs_rendering.builder import BlockType, TableBlock, TextBlock
from services.google_workspace.docs_rendering import theme


def _rgb(color: tuple[float, float, float]) -> dict[str, float]:
    r, g, b = color
    return {"red": r, "green": g, "blue": b}


def _optional_color(color: tuple[float, float, float]) -> dict[str, Any]:
    """Google Docs OptionalColor: { color: { rgbColor: ... } }."""
    return {"color": {"rgbColor": _rgb(color)}}


def _text_style(
    *,
    font: str | None = None,
    size: float | None = None,
    bold: bool = False,
    italic: bool = False,
    color: tuple[float, float, float] | None = None,
    background: tuple[float, float, float] | None = None,
) -> dict[str, Any]:
    fields: list[str] = []
    style: dict[str, Any] = {}
    if font:
        style["weightedFontFamily"] = {"fontFamily": font, "weight": 700 if bold else 400}
        fields.append("weightedFontFamily")
    if size is not None:
        style["fontSize"] = {"magnitude": size, "unit": "PT"}
        fields.append("fontSize")
    if bold:
        style["bold"] = True
        fields.append("bold")
    if italic:
        style["italic"] = True
        fields.append("italic")
    if color:
        style["foregroundColor"] = _optional_color(color)
        fields.append("foregroundColor")
    if background:
        style["backgroundColor"] = _optional_color(background)
        fields.append("backgroundColor")
    if not fields:
        return {}
    return {"textStyle": style, "fields": ",".join(fields)}


def _paragraph_style(
    *,
    named: str | None = None,
    space_above: float | None = None,
    space_below: float | None = None,
) -> dict[str, Any]:
    fields: list[str] = []
    style: dict[str, Any] = {}
    if named:
        style["namedStyleType"] = named
        fields.append("namedStyleType")
    if space_above is not None:
        style["spaceAbove"] = {"magnitude": space_above, "unit": "PT"}
        fields.append("spaceAbove")
    if space_below is not None:
        style["spaceBelow"] = {"magnitude": space_below, "unit": "PT"}
        fields.append("spaceBelow")
    if not fields:
        return {}
    return {"paragraphStyle": style, "fields": ",".join(fields)}


def _block_font(block: TextBlock) -> tuple[str, float, bool, tuple[float, float, float] | None]:
    bt = block.block_type
    if bt == BlockType.TITLE:
        return theme.FONT_DISPLAY, theme.SIZE_TITLE, True, block.color or theme.COLOR_TITLE
    if bt == BlockType.HEADING1:
        return theme.FONT_BODY, theme.SIZE_H1, True, block.color or theme.COLOR_H1
    if bt == BlockType.HEADING2:
        return theme.FONT_BODY, theme.SIZE_H2, True, block.color or theme.COLOR_H2
    if bt == BlockType.META:
        return theme.FONT_BODY, theme.SIZE_META, False, block.color or theme.COLOR_META
    if bt == BlockType.BULLET:
        return theme.FONT_BODY, theme.SIZE_BULLET, block.bold, block.color or theme.COLOR_BODY
    if bt == BlockType.CODE:
        return "Courier New", 9.5, False, block.color or (0.12, 0.15, 0.2)
    return theme.FONT_BODY, theme.SIZE_BODY, block.bold, block.color or theme.COLOR_BODY


def _block_spacing(block: TextBlock) -> tuple[float, float]:
    bt = block.block_type
    if bt == BlockType.TITLE:
        return theme.SPACE_TITLE_ABOVE, theme.SPACE_TITLE_BELOW
    if bt == BlockType.HEADING1:
        return theme.SPACE_H1_ABOVE, theme.SPACE_H1_BELOW
    if bt == BlockType.HEADING2:
        return theme.SPACE_H2_ABOVE, theme.SPACE_H2_BELOW
    if bt == BlockType.META:
        return theme.SPACE_META_ABOVE, theme.SPACE_META_BELOW
    if bt == BlockType.BULLET:
        return theme.SPACE_BULLET_ABOVE, theme.SPACE_BULLET_BELOW
    if bt == BlockType.DIVIDER:
        return theme.SPACE_DIVIDER_ABOVE, theme.SPACE_DIVIDER_BELOW
    if bt == BlockType.CODE:
        return 6, 8
    return theme.SPACE_BODY_ABOVE, theme.SPACE_BODY_BELOW


def _table_structure_size(rows: int, cols: int) -> int:
    """Structural index span of an empty Docs table element."""
    return 3 + rows * (1 + cols * 2)


def _cell_content_index(table_start: int, row: int, col: int, cols: int) -> int:
    """Insert index for cell text in an empty table (pre-insertion)."""
    return table_start + 3 + row * (2 * cols + 1) + col * 2 + 1


def _table_post_index(
    table_start: int,
    num_rows: int,
    num_cols: int,
    rows: list[list[str]],
) -> int:
    """Document index immediately after a fully populated table."""
    total_chars = sum(len(cell) for row in rows for cell in row if cell)
    return table_start + _table_structure_size(num_rows, num_cols) + total_chars


def _cell_placements(
    table_start: int,
    rows: list[list[str]],
    num_cols: int,
) -> list[tuple[int, int, int, int, str, bool]]:
    """Return (row, col, style_start, style_end, text, is_header) with post-insert indices."""
    num_rows = len(rows)
    placements: list[tuple[int, int, int, int, str, bool]] = []
    for r in range(num_rows):
        for c in range(num_cols):
            if c >= len(rows[r]):
                continue
            text = rows[r][c]
            if not text:
                continue
            base = _cell_content_index(table_start, r, c, num_cols)
            shift = sum(
                len(rows[rr][cc])
                for rr in range(num_rows)
                for cc in range(num_cols)
                if cc < len(rows[rr]) and rows[rr][cc] and (rr, cc) < (r, c)
            )
            start = base + shift
            placements.append((r, c, start, start + len(text), text, r == 0))
    return placements


def _render_table(table: TableBlock, table_start: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows = [table.headers, *table.rows]
    num_rows = len(rows)
    num_cols = len(table.headers)
    insert_requests: list[dict[str, Any]] = [
        {
            "insertTable": {
                "rows": num_rows,
                "columns": num_cols,
                "location": {"index": table_start},
            }
        }
    ]
    style_requests: list[dict[str, Any]] = []

    placements = _cell_placements(table_start, rows, num_cols)

    for r, c, _, _, text, _ in sorted(placements, key=lambda p: (p[0], p[1]), reverse=True):
        insert_requests.append(
            {
                "insertText": {
                    "location": {"index": _cell_content_index(table_start, r, c, num_cols)},
                    "text": text,
                }
            }
        )

    header_bg = table.header_bg or theme.COLOR_TABLE_HEADER_BG
    for r, c, start, end, _, is_header in placements:
        text_spec = _text_style(
            font=theme.FONT_BODY,
            size=theme.SIZE_TABLE,
            bold=is_header,
            color=theme.COLOR_ON_DARK if is_header else theme.COLOR_BODY,
        )
        if text_spec:
            style_requests.append(
                {
                    "updateTextStyle": {
                        "range": {"startIndex": start, "endIndex": end},
                        **text_spec,
                    }
                }
            )
        if is_header:
            style_requests.append(
                {
                    "updateTableCellStyle": {
                        "tableCellStyle": {
                            "backgroundColor": _optional_color(header_bg),
                        },
                        "fields": "backgroundColor",
                        "tableRange": {
                            "tableCellLocation": {
                                "tableStartLocation": {"index": table_start},
                                "rowIndex": r,
                                "columnIndex": c,
                            },
                            "rowSpan": 1,
                            "columnSpan": 1,
                        },
                    }
                }
            )
        elif r % 2 == 0:
            style_requests.append(
                {
                    "updateTableCellStyle": {
                        "tableCellStyle": {
                            "backgroundColor": _optional_color(theme.COLOR_TABLE_ROW_ALT),
                        },
                        "fields": "backgroundColor",
                        "tableRange": {
                            "tableCellLocation": {
                                "tableStartLocation": {"index": table_start},
                                "rowIndex": r,
                                "columnIndex": c,
                            },
                            "rowSpan": 1,
                            "columnSpan": 1,
                        },
                    }
                }
            )

    style_requests.append(
        {
            "updateTableCellStyle": {
                "tableCellStyle": {
                    "borderTop": {
                        "color": _optional_color(theme.COLOR_BORDER),
                        "width": {"magnitude": 0.5, "unit": "PT"},
                        "dashStyle": "SOLID",
                    },
                    "borderBottom": {
                        "color": _optional_color(theme.COLOR_BORDER),
                        "width": {"magnitude": 0.5, "unit": "PT"},
                        "dashStyle": "SOLID",
                    },
                    "borderLeft": {
                        "color": _optional_color(theme.COLOR_BORDER),
                        "width": {"magnitude": 0.5, "unit": "PT"},
                        "dashStyle": "SOLID",
                    },
                    "borderRight": {
                        "color": _optional_color(theme.COLOR_BORDER),
                        "width": {"magnitude": 0.5, "unit": "PT"},
                        "dashStyle": "SOLID",
                    },
                },
                "fields": "borderTop,borderBottom,borderLeft,borderRight",
                "tableRange": {
                    "tableCellLocation": {
                        "tableStartLocation": {"index": table_start},
                        "rowIndex": 0,
                        "columnIndex": 0,
                    },
                    "rowSpan": num_rows,
                    "columnSpan": num_cols,
                },
            }
        }
    )
    return insert_requests, style_requests


def render(blocks: list[TextBlock | TableBlock]) -> list[dict[str, Any]]:
    """Convert blocks to a batchUpdate request list."""
    content, styles = render_phases(blocks)
    return content + styles


def render_phases(
    blocks: list[TextBlock | TableBlock],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (content_inserts, styling) as separate request lists."""
    content_requests: list[dict[str, Any]] = []
    style_requests: list[dict[str, Any]] = []

    index = 1
    bullet_ranges: list[tuple[int, int]] = []

    for block in blocks:
        if isinstance(block, TextBlock):
            text = block.text + "\n"
            start = index
            end = index + len(text)
            content_requests.append(
                {"insertText": {"location": {"index": start}, "text": text}}
            )

            font, size, bold, color = _block_font(block)
            text_spec = _text_style(
                font=font,
                size=size,
                bold=bold or block.bold,
                italic=block.italic,
                color=color,
                background=(0.94, 0.95, 0.96) if block.block_type == BlockType.CODE else None,
            )
            if text_spec:
                style_requests.append(
                    {
                        "updateTextStyle": {
                            "range": {"startIndex": start, "endIndex": end},
                            **text_spec,
                        }
                    }
                )
            above, below = _block_spacing(block)
            para = _paragraph_style(space_above=above, space_below=below)
            if block.block_type == BlockType.DIVIDER:
                para = _paragraph_style(
                    space_above=above,
                    space_below=below,
                    named="NORMAL_TEXT",
                )
            if para:
                style_requests.append(
                    {
                        "updateParagraphStyle": {
                            "range": {"startIndex": start, "endIndex": end},
                            **para,
                        }
                    }
                )
            if block.block_type == BlockType.BULLET:
                bullet_ranges.append((start, end))
            index = end

        elif isinstance(block, TableBlock):
            table_start = index
            rows = [block.headers, *block.rows]
            table_inserts, table_styles = _render_table(block, table_start)
            content_requests.extend(table_inserts)
            style_requests.extend(table_styles)
            index = _table_post_index(
                table_start,
                len(rows),
                len(block.headers),
                rows,
            )

    for start, end in bullet_ranges:
        style_requests.append(
            {
                "createParagraphBullets": {
                    "range": {"startIndex": start, "endIndex": end},
                    "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                }
            }
        )

    return content_requests, style_requests
