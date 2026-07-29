"""Visual constants for Google Docs lesson plan rendering.

Copied from Pnai-ai/pnai/tools/google_docs/theme.py — kept in sync manually.
"""

from __future__ import annotations

from typing import Final

# Fonts (Google Docs weightedFontFamily)
FONT_DISPLAY: Final[str] = "Playfair Display"
FONT_BODY: Final[str] = "Lato"

# Colors as RGB floats 0.0–1.0
COLOR_TITLE: Final[tuple[float, float, float]] = (0.0, 0.35, 0.38)
COLOR_H1: Final[tuple[float, float, float]] = (0.0, 0.35, 0.38)
COLOR_H2: Final[tuple[float, float, float]] = (0.15, 0.50, 0.52)
COLOR_ACCENT: Final[tuple[float, float, float]] = (0.15, 0.50, 0.52)
COLOR_BODY: Final[tuple[float, float, float]] = (0.15, 0.13, 0.12)
COLOR_META: Final[tuple[float, float, float]] = (0.45, 0.45, 0.45)
COLOR_TABLE_HEADER_BG: Final[tuple[float, float, float]] = (0.55, 0.78, 0.80)
COLOR_TABLE_ROW_ALT: Final[tuple[float, float, float]] = (0.96, 0.98, 0.98)
COLOR_BORDER: Final[tuple[float, float, float]] = (0.82, 0.84, 0.86)
COLOR_ON_DARK: Final[tuple[float, float, float]] = (1.0, 1.0, 1.0)

# Paragraph spacing (points)
SPACE_TITLE_ABOVE: Final[float] = 0.0
SPACE_TITLE_BELOW: Final[float] = 6.0
SPACE_H1_ABOVE: Final[float] = 18.0
SPACE_H1_BELOW: Final[float] = 6.0
SPACE_H2_ABOVE: Final[float] = 12.0
SPACE_H2_BELOW: Final[float] = 4.0
SPACE_BODY_ABOVE: Final[float] = 0.0
SPACE_BODY_BELOW: Final[float] = 6.0
SPACE_BULLET_ABOVE: Final[float] = 0.0
SPACE_BULLET_BELOW: Final[float] = 2.0
SPACE_META_ABOVE: Final[float] = 0.0
SPACE_META_BELOW: Final[float] = 2.0
SPACE_DIVIDER_ABOVE: Final[float] = 8.0
SPACE_DIVIDER_BELOW: Final[float] = 8.0

# Font sizes (points)
SIZE_TITLE: Final[float] = 28.0
SIZE_H1: Final[float] = 16.0
SIZE_H2: Final[float] = 13.0
SIZE_BODY: Final[float] = 11.0
SIZE_BULLET: Final[float] = 11.0
SIZE_META: Final[float] = 10.0
SIZE_TABLE: Final[float] = 10.0
