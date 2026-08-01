"""PNAI theme + structure contract for Google Docs rendering."""

from __future__ import annotations

from services.google_workspace.docs_rendering import theme
from services.google_workspace.docs_rendering.builder import BlockType, TableBlock, TextBlock
from services.google_workspace.docs_rendering.renderer import render_phases
from services.google_workspace.docs_service import _remap_table_style_starts


def _para_styles(styles):
    return [r["updateParagraphStyle"] for r in styles if "updateParagraphStyle" in r]


def _text_styles(styles):
    return [r["updateTextStyle"] for r in styles if "updateTextStyle" in r]


def test_headings_carry_named_styles_for_the_outline_pane():
    blocks = [
        TextBlock(BlockType.TITLE, "T"),
        TextBlock(BlockType.HEADING1, "One"),
        TextBlock(BlockType.HEADING2, "Two"),
        TextBlock(BlockType.HEADING3, "Three"),
        TextBlock(BlockType.BODY, "b"),
    ]
    _, styles = render_phases(blocks)
    named = [p["paragraphStyle"].get("namedStyleType") for p in _para_styles(styles)]
    assert named[:4] == ["TITLE", "HEADING_1", "HEADING_2", "HEADING_3"]
    assert named[4] is None  # body stays NORMAL_TEXT by default


def test_h1_gets_section_rule_and_display_font():
    _, styles = render_phases([TextBlock(BlockType.HEADING1, "Section")])
    para = _para_styles(styles)[0]["paragraphStyle"]
    assert "borderBottom" in para
    text = _text_styles(styles)[0]["textStyle"]
    assert text["weightedFontFamily"]["fontFamily"] == theme.FONT_DISPLAY


def test_paragraph_style_applied_before_text_style():
    """Named styles reset text appearance — the explicit theme must win."""
    _, styles = render_phases([TextBlock(BlockType.HEADING1, "Section")])
    kinds = [next(iter(r)) for r in styles]
    assert kinds.index("updateParagraphStyle") < kinds.index("updateTextStyle")


def test_divider_renders_as_border_rule_not_glyphs():
    content, styles = render_phases([TextBlock(BlockType.DIVIDER, "―" * 48)])
    assert content[0]["insertText"]["text"] == "\n"
    para = _para_styles(styles)[0]["paragraphStyle"]
    assert "borderBottom" in para


def test_quote_block_gets_bar_indent_and_italic():
    _, styles = render_phases([TextBlock(BlockType.QUOTE, "Ask the model…")])
    para = _para_styles(styles)[0]["paragraphStyle"]
    assert "borderLeft" in para and "indentStart" in para
    assert _text_styles(styles)[0]["textStyle"]["italic"] is True


def test_code_block_gets_shading_and_mono_font():
    _, styles = render_phases([TextBlock(BlockType.CODE, "print('hi')")])
    para = _para_styles(styles)[0]["paragraphStyle"]
    assert "shading" in para
    text = _text_styles(styles)[0]["textStyle"]
    assert text["weightedFontFamily"]["fontFamily"] == theme.FONT_CODE


def test_checklist_uses_real_checkbox_bullets():
    _, styles = render_phases(
        [TextBlock(BlockType.CHECKLIST, "screenshot"), TextBlock(BlockType.BULLET, "note")]
    )
    presets = [
        r["createParagraphBullets"]["bulletPreset"]
        for r in styles
        if "createParagraphBullets" in r
    ]
    assert "BULLET_CHECKBOX" in presets and "BULLET_DISC_CIRCLE_SQUARE" in presets


def test_kv_table_has_label_column_not_header_row():
    table = TableBlock(headers=["Student sees", "Do the thing"], rows=[["Est. time", "5 min"]], kv=True)
    _, styles = render_phases([table])
    cell_bgs = [
        r["updateTableCellStyle"]
        for r in styles
        if "updateTableCellStyle" in r and "backgroundColor" in r["updateTableCellStyle"]["tableCellStyle"]
    ]
    # Label-column tint on column 0 of both rows; never the header violet.
    assert all(
        bg["tableRange"]["tableCellLocation"]["columnIndex"] == 0 for bg in cell_bgs
    )
    header_rgb = {"red": theme.COLOR_TABLE_HEADER_BG[0], "green": theme.COLOR_TABLE_HEADER_BG[1], "blue": theme.COLOR_TABLE_HEADER_BG[2]}
    assert all(
        bg["tableCellStyle"]["backgroundColor"]["color"]["rgbColor"] != header_rgb
        for bg in cell_bgs
    )


def _column_widths(styles):
    widths: dict[int, float] = {}
    for r in styles:
        req = r.get("updateTableColumnProperties")
        if not req:
            continue
        for col in req["columnIndices"]:
            widths[col] = req["tableColumnProperties"]["width"]["magnitude"]
    return widths


def test_every_table_fits_the_page_width():
    """API-inserted tables don't auto-fit — explicit widths must total the page."""
    rubric = TableBlock(
        headers=["Criterion", "Points", "Excellent", "Satisfactory", "Needs Work"],
        rows=[["Mapping", "20", "Clear", "Basic", "Missing"]],
    )
    _, styles = render_phases([rubric])
    widths = _column_widths(styles)
    assert set(widths) == {0, 1, 2, 3, 4}
    assert abs(sum(widths.values()) - theme.PAGE_CONTENT_WIDTH) < 1.0
    # "Points" is numeric — narrow, so the prose columns get the width.
    assert widths[1] < widths[0]


def test_kv_table_widths_total_the_page():
    table = TableBlock(headers=["Student sees", "Do it"], rows=[["Est. time", "5 min"]], kv=True)
    _, styles = render_phases([table])
    widths = _column_widths(styles)
    assert widths[0] == theme.KV_LABEL_COL_WIDTH
    assert abs(sum(widths.values()) - theme.PAGE_CONTENT_WIDTH) < 1.0


def test_nested_lab_enums_render_as_values_not_enum_reprs():
    from services.google_workspace.docs_rendering.schemas import LabFull

    lab = LabFull.model_validate(
        {"title": "T", "safety_profile": {"risk_level": "low"}, "environment_profile": {"modality": "wet_lab"}}
    )
    # str() lands directly in the exported doc — "LabRiskLevel.low" did too.
    assert str(lab.safety_profile.risk_level) == "low"
    assert str(lab.environment_profile.modality) == "wet_lab"


def test_regular_table_keeps_brand_header_row():
    table = TableBlock(headers=["Time", "Activity"], rows=[["0–10", "Intro"]])
    _, styles = render_phases([table])
    header_bgs = [
        r
        for r in styles
        if "updateTableCellStyle" in r
        and r["updateTableCellStyle"]["tableCellStyle"].get("backgroundColor", {})
        .get("color", {})
        .get("rgbColor", {})
        .get("red")
        == theme.COLOR_TABLE_HEADER_BG[0]
    ]
    assert len(header_bgs) == 2  # one per header cell


def test_remap_handles_column_properties_requests():
    requests = [
        {
            "updateTableColumnProperties": {
                "tableStartLocation": {"index": 10},
                "columnIndices": [0],
                "tableColumnProperties": {"widthType": "FIXED_WIDTH"},
                "fields": "widthType,width",
            }
        },
        {
            "updateTableCellStyle": {
                "tableCellStyle": {},
                "fields": "backgroundColor",
                "tableRange": {
                    "tableCellLocation": {
                        "tableStartLocation": {"index": 10},
                        "rowIndex": 0,
                        "columnIndex": 0,
                    },
                    "rowSpan": 1,
                    "columnSpan": 1,
                },
            }
        },
    ]
    _remap_table_style_starts(requests, {10: 42})
    assert requests[0]["updateTableColumnProperties"]["tableStartLocation"]["index"] == 42
    assert (
        requests[1]["updateTableCellStyle"]["tableRange"]["tableCellLocation"][
            "tableStartLocation"
        ]["index"]
        == 42
    )
