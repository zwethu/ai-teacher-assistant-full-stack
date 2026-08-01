"""Visual constants for Google Docs artifact rendering.

Aligned with the PNAI app theme (frontend/src/index.css + Tailwind palette):
Plus Jakarta Sans for display, Inter for body, violet-600 brand accents on
slate text. All three families are Google Fonts available in Docs; Docs falls
back to Arial for unknown families, so nothing breaks if a font is renamed.
"""

from __future__ import annotations

from typing import Final

# Fonts (Google Docs weightedFontFamily)
FONT_DISPLAY: Final[str] = "Plus Jakarta Sans"
FONT_BODY: Final[str] = "Inter"
FONT_CODE: Final[str] = "Roboto Mono"

# Colors as RGB floats 0.0–1.0 (Tailwind palette used by the app)
_VIOLET_600: Final = (0.486, 0.227, 0.929)  # #7c3aed — brand / buttons
_VIOLET_800: Final = (0.357, 0.129, 0.714)  # #5b21b6
_VIOLET_300: Final = (0.769, 0.710, 0.992)  # #c4b5fd
_VIOLET_200: Final = (0.867, 0.839, 0.996)  # #ddd6fe
_VIOLET_50: Final = (0.961, 0.953, 1.0)     # #f5f3ff
_SLATE_950: Final = (0.008, 0.024, 0.090)   # #020617
_SLATE_800: Final = (0.118, 0.161, 0.231)   # #1e293b
_SLATE_700: Final = (0.200, 0.255, 0.333)   # #334155
_SLATE_500: Final = (0.392, 0.455, 0.545)   # #64748b
_SLATE_200: Final = (0.886, 0.910, 0.941)   # #e2e8f0
_SLATE_100: Final = (0.945, 0.961, 0.976)   # #f1f5f9

COLOR_TITLE: Final[tuple[float, float, float]] = _SLATE_950
COLOR_H1: Final[tuple[float, float, float]] = _VIOLET_800
COLOR_H2: Final[tuple[float, float, float]] = _SLATE_950
COLOR_H3: Final[tuple[float, float, float]] = _VIOLET_800
COLOR_ACCENT: Final[tuple[float, float, float]] = _VIOLET_600
COLOR_BODY: Final[tuple[float, float, float]] = _SLATE_800
COLOR_META: Final[tuple[float, float, float]] = _SLATE_500
COLOR_TABLE_HEADER_BG: Final[tuple[float, float, float]] = _VIOLET_600
COLOR_TABLE_ROW_ALT: Final[tuple[float, float, float]] = _VIOLET_50
COLOR_KV_LABEL_BG: Final[tuple[float, float, float]] = _VIOLET_50
COLOR_KV_LABEL_TEXT: Final[tuple[float, float, float]] = _SLATE_700
COLOR_BORDER: Final[tuple[float, float, float]] = _SLATE_200
COLOR_H1_RULE: Final[tuple[float, float, float]] = _VIOLET_200
COLOR_ON_DARK: Final[tuple[float, float, float]] = (1.0, 1.0, 1.0)
COLOR_CODE_BG: Final[tuple[float, float, float]] = _SLATE_100
COLOR_CODE_TEXT: Final[tuple[float, float, float]] = _SLATE_800
COLOR_QUOTE_BAR: Final[tuple[float, float, float]] = _VIOLET_300
COLOR_QUOTE_TEXT: Final[tuple[float, float, float]] = _SLATE_700

# Paragraph spacing (points)
SPACE_TITLE_ABOVE: Final[float] = 0.0
SPACE_TITLE_BELOW: Final[float] = 4.0
SPACE_H1_ABOVE: Final[float] = 20.0
SPACE_H1_BELOW: Final[float] = 8.0
SPACE_H2_ABOVE: Final[float] = 12.0
SPACE_H2_BELOW: Final[float] = 4.0
SPACE_H3_ABOVE: Final[float] = 10.0
SPACE_H3_BELOW: Final[float] = 3.0
SPACE_BODY_ABOVE: Final[float] = 0.0
SPACE_BODY_BELOW: Final[float] = 6.0
SPACE_BULLET_ABOVE: Final[float] = 0.0
SPACE_BULLET_BELOW: Final[float] = 2.0
SPACE_META_ABOVE: Final[float] = 0.0
SPACE_META_BELOW: Final[float] = 2.0
SPACE_DIVIDER_ABOVE: Final[float] = 10.0
SPACE_DIVIDER_BELOW: Final[float] = 10.0
SPACE_CODE_ABOVE: Final[float] = 4.0
SPACE_CODE_BELOW: Final[float] = 8.0
SPACE_QUOTE_ABOVE: Final[float] = 4.0
SPACE_QUOTE_BELOW: Final[float] = 6.0

# Font sizes (points)
SIZE_TITLE: Final[float] = 24.0
SIZE_H1: Final[float] = 15.0
SIZE_H2: Final[float] = 12.5
SIZE_H3: Final[float] = 11.0
SIZE_BODY: Final[float] = 11.0
SIZE_BULLET: Final[float] = 11.0
SIZE_META: Final[float] = 9.5
SIZE_TABLE: Final[float] = 10.0
SIZE_CODE: Final[float] = 9.5
SIZE_QUOTE: Final[float] = 11.0

# Structure metrics (points)
H1_RULE_WIDTH: Final[float] = 1.0
QUOTE_BAR_WIDTH: Final[float] = 2.25
QUOTE_INDENT: Final[float] = 16.0
CODE_INDENT: Final[float] = 8.0
TABLE_CELL_PADDING: Final[float] = 5.0
KV_LABEL_COL_WIDTH: Final[float] = 130.0
