"""Canonical markdown preview for a staged term/definition game."""

from __future__ import annotations

from typing import Any

RENDERER_VERSION = "game_markdown.v1"

# The preview is a review surface, not the game. Rendering all 40 cards of a large game
# would bury the "Create game" button, so the tail is summarised instead.
_PREVIEW_ITEM_LIMIT = 10


def render_game_markdown(payload: dict[str, Any]) -> str:
    title = str(payload.get("title") or "Study Game").strip()
    items = [item for item in (payload.get("items") or []) if isinstance(item, dict)]

    lines = [
        f"**🎮 Game ready:** {title}",
        "",
        f"**{len(items)} term/definition pairs**",
        "",
    ]
    for item in items[:_PREVIEW_ITEM_LIMIT]:
        term = str(item.get("term") or "").strip()
        definition = str(item.get("definition") or "").strip()
        if term and definition:
            lines.append(f"- **{term}** — {definition}")

    remaining = len(items) - _PREVIEW_ITEM_LIMIT
    if remaining > 0:
        lines.append(f"- _…and {remaining} more_")

    return "\n".join(lines).strip()
