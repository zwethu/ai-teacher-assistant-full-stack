"""Render DocBuilder blocks into Google Docs batchUpdate requests.

Headings carry real named styles (HEADING_1/2/3), so exported docs get the
outline navigation pane and our own structured-read path (which keys on
namedStyleType) can see them. Explicit text styles are applied after the
named style so the PNAI theme always wins over the Docs defaults.
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


def _pt(magnitude: float) -> dict[str, Any]:
    return {"magnitude": magnitude, "unit": "PT"}


def _border(color: tuple[float, float, float], width: float, padding: float) -> dict[str, Any]:
    return {
        "color": _optional_color(color),
        "width": _pt(width),
        "padding": _pt(padding),
        "dashStyle": "SOLID",
    }


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
        style["fontSize"] = _pt(size)
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
    indent_start: float | None = None,
    border_bottom: dict[str, Any] | None = None,
    border_left: dict[str, Any] | None = None,
    shading: tuple[float, float, float] | None = None,
) -> dict[str, Any]:
    fields: list[str] = []
    style: dict[str, Any] = {}
    if named:
        style["namedStyleType"] = named
        fields.append("namedStyleType")
    if space_above is not None:
        style["spaceAbove"] = _pt(space_above)
        fields.append("spaceAbove")
    if space_below is not None:
        style["spaceBelow"] = _pt(space_below)
        fields.append("spaceBelow")
    if indent_start is not None:
        style["indentStart"] = _pt(indent_start)
        fields.append("indentStart")
    if border_bottom is not None:
        style["borderBottom"] = border_bottom
        fields.append("borderBottom")
    if border_left is not None:
        style["borderLeft"] = border_left
        fields.append("borderLeft")
    if shading is not None:
        style["shading"] = {"backgroundColor": _optional_color(shading)}
        fields.append("shading")
    if not fields:
        return {}
    return {"paragraphStyle": style, "fields": ",".join(fields)}


_NAMED_STYLE: dict[BlockType, str] = {
    BlockType.TITLE: "TITLE",
    BlockType.HEADING1: "HEADING_1",
    BlockType.HEADING2: "HEADING_2",
    BlockType.HEADING3: "HEADING_3",
}


def _block_font(block: TextBlock) -> tuple[str, float, bool, tuple[float, float, float] | None]:
    bt = block.block_type
    if bt == BlockType.TITLE:
        return theme.FONT_DISPLAY, theme.SIZE_TITLE, True, block.color or theme.COLOR_TITLE
    if bt == BlockType.HEADING1:
        return theme.FONT_DISPLAY, theme.SIZE_H1, True, block.color or theme.COLOR_H1
    if bt == BlockType.HEADING2:
        return theme.FONT_DISPLAY, theme.SIZE_H2, True, block.color or theme.COLOR_H2
    if bt == BlockType.HEADING3:
        return theme.FONT_BODY, theme.SIZE_H3, True, block.color or theme.COLOR_H3
    if bt == BlockType.META:
        return theme.FONT_BODY, theme.SIZE_META, False, block.color or theme.COLOR_META
    if bt == BlockType.BULLET or bt == BlockType.CHECKLIST:
        return theme.FONT_BODY, theme.SIZE_BULLET, block.bold, block.color or theme.COLOR_BODY
    if bt == BlockType.CODE:
        return theme.FONT_CODE, theme.SIZE_CODE, False, block.color or theme.COLOR_CODE_TEXT
    if bt == BlockType.QUOTE:
        return theme.FONT_BODY, theme.SIZE_QUOTE, block.bold, block.color or theme.COLOR_QUOTE_TEXT
    return theme.FONT_BODY, theme.SIZE_BODY, block.bold, block.color or theme.COLOR_BODY


def _block_spacing(block: TextBlock) -> tuple[float, float]:
    bt = block.block_type
    if bt == BlockType.TITLE:
        return theme.SPACE_TITLE_ABOVE, theme.SPACE_TITLE_BELOW
    if bt == BlockType.HEADING1:
        return theme.SPACE_H1_ABOVE, theme.SPACE_H1_BELOW
    if bt == BlockType.HEADING2:
        return theme.SPACE_H2_ABOVE, theme.SPACE_H2_BELOW
    if bt == BlockType.HEADING3:
        return theme.SPACE_H3_ABOVE, theme.SPACE_H3_BELOW
    if bt == BlockType.META:
        return theme.SPACE_META_ABOVE, theme.SPACE_META_BELOW
    if bt == BlockType.BULLET or bt == BlockType.CHECKLIST:
        return theme.SPACE_BULLET_ABOVE, theme.SPACE_BULLET_BELOW
    if bt == BlockType.DIVIDER:
        return theme.SPACE_DIVIDER_ABOVE, theme.SPACE_DIVIDER_BELOW
    if bt == BlockType.CODE:
        return theme.SPACE_CODE_ABOVE, theme.SPACE_CODE_BELOW
    if bt == BlockType.QUOTE:
        return theme.SPACE_QUOTE_ABOVE, theme.SPACE_QUOTE_BELOW
    return theme.SPACE_BODY_ABOVE, theme.SPACE_BODY_BELOW


def _block_paragraph_extras(block: TextBlock) -> dict[str, Any]:
    """Structural paragraph styling beyond spacing, per block type."""
    bt = block.block_type
    if bt == BlockType.HEADING1:
        # Section rule under every H1 — carries the structure the old literal
        # "―――" divider glyphs used to fake.
        return {"border_bottom": _border(theme.COLOR_H1_RULE, theme.H1_RULE_WIDTH, 3.0)}
    if bt == BlockType.DIVIDER:
        return {
            "named": "NORMAL_TEXT",
            "border_bottom": _border(theme.COLOR_BORDER, 0.5, 0.0),
        }
    if bt == BlockType.CODE:
        # Full-width shading reads as a real code block, not highlighted text.
        return {"shading": theme.COLOR_CODE_BG, "indent_start": theme.CODE_INDENT}
    if bt == BlockType.QUOTE:
        return {
            "border_left": _border(theme.COLOR_QUOTE_BAR, theme.QUOTE_BAR_WIDTH, 8.0),
            "indent_start": theme.QUOTE_INDENT,
        }
    return {}


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


def _cell_bg_request(
    table_start: int, r: int, c: int, color: tuple[float, float, float]
) -> dict[str, Any]:
    return {
        "updateTableCellStyle": {
            "tableCellStyle": {"backgroundColor": _optional_color(color)},
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
        if table.kv:
            # Key-value table: no header row — the first column is the label.
            is_label = c == 0
            text_spec = _text_style(
                font=theme.FONT_BODY,
                size=theme.SIZE_TABLE,
                bold=is_label,
                color=theme.COLOR_KV_LABEL_TEXT if is_label else theme.COLOR_BODY,
            )
        else:
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
        if table.kv:
            if c == 0:
                style_requests.append(
                    _cell_bg_request(table_start, r, c, theme.COLOR_KV_LABEL_BG)
                )
        elif is_header:
            style_requests.append(_cell_bg_request(table_start, r, c, header_bg))
        elif r % 2 == 0:
            style_requests.append(
                _cell_bg_request(table_start, r, c, theme.COLOR_TABLE_ROW_ALT)
            )

    if table.kv:
        # A narrow fixed label column keeps the value column wide and scannable.
        style_requests.append(
            {
                "updateTableColumnProperties": {
                    "tableStartLocation": {"index": table_start},
                    "columnIndices": [0],
                    "tableColumnProperties": {
                        "widthType": "FIXED_WIDTH",
                        "width": _pt(theme.KV_LABEL_COL_WIDTH),
                    },
                    "fields": "widthType,width",
                }
            }
        )

    border = _border(theme.COLOR_BORDER, 0.5, 0.0)
    border.pop("padding", None)  # cell borders have no padding field
    style_requests.append(
        {
            "updateTableCellStyle": {
                "tableCellStyle": {
                    "borderTop": border,
                    "borderBottom": border,
                    "borderLeft": border,
                    "borderRight": border,
                    "paddingTop": _pt(theme.TABLE_CELL_PADDING),
                    "paddingBottom": _pt(theme.TABLE_CELL_PADDING),
                    "paddingLeft": _pt(theme.TABLE_CELL_PADDING),
                    "paddingRight": _pt(theme.TABLE_CELL_PADDING),
                },
                "fields": (
                    "borderTop,borderBottom,borderLeft,borderRight,"
                    "paddingTop,paddingBottom,paddingLeft,paddingRight"
                ),
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
    checklist_ranges: list[tuple[int, int]] = []

    for block in blocks:
        if isinstance(block, TextBlock):
            # A divider is a rule drawn with a paragraph border — never glyphs.
            raw = "" if block.block_type == BlockType.DIVIDER else block.text
            text = raw + "\n"
            start = index
            end = index + len(text)
            content_requests.append(
                {"insertText": {"location": {"index": start}, "text": text}}
            )

            above, below = _block_spacing(block)
            extras = _block_paragraph_extras(block)
            named = extras.pop("named", None) or _NAMED_STYLE.get(block.block_type)
            para = _paragraph_style(
                named=named,
                space_above=above,
                space_below=below,
                **extras,
            )
            # Paragraph style first: applying a named heading style resets the
            # paragraph's look, so the explicit text style must come after it.
            if para:
                style_requests.append(
                    {
                        "updateParagraphStyle": {
                            "range": {"startIndex": start, "endIndex": end},
                            **para,
                        }
                    }
                )

            font, size, bold, color = _block_font(block)
            text_spec = _text_style(
                font=font,
                size=size,
                bold=bold or block.bold,
                italic=block.italic or block.block_type == BlockType.QUOTE,
                color=color,
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
            if block.block_type == BlockType.BULLET:
                bullet_ranges.append((start, end))
            elif block.block_type == BlockType.CHECKLIST:
                checklist_ranges.append((start, end))
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
    for start, end in checklist_ranges:
        style_requests.append(
            {
                "createParagraphBullets": {
                    "range": {"startIndex": start, "endIndex": end},
                    "bulletPreset": "BULLET_CHECKBOX",
                }
            }
        )

    return content_requests, style_requests
