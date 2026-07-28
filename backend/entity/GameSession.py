from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

# Kept in sync with pnai/agents/game/schemas.py — the agent validates against the same
# bounds before staging, so a payload that reaches here should already satisfy them.
# Re-validating is deliberate: the pending artifact is agent-authored input, and the
# backend is the only writer of gameSessions.
MIN_GAME_ITEMS = 4
MAX_GAME_ITEMS = 40

# Play modes a created game supports. gameModeStats is seeded with a zero counter per
# mode so the player app can increment without first creating the key. These exact
# spellings are the stored document's keys — "ropelink", not "rope_link".
GAME_MODES = ("bucket", "matching", "ropelink")

# A created game stays playable for this long unless the caller asks for a shorter life.
DEFAULT_GAME_TTL_DAYS = 30


class GameItemModel(BaseModel):
    """One playable card: a term and its definition."""

    term: str = Field(min_length=1, max_length=300)
    definition: str = Field(min_length=1, max_length=2000)

    @field_validator("term", "definition")
    @classmethod
    def strip_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("term and definition cannot be blank")
        return cleaned


class GameContent(BaseModel):
    """The agent-authored game content carried on the pending artifact."""

    title: str = Field(min_length=1, max_length=300)
    items: list[GameItemModel] = Field(min_length=MIN_GAME_ITEMS, max_length=MAX_GAME_ITEMS)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("title cannot be blank")
        return cleaned

    @model_validator(mode="after")
    def validate_unique_terms(self) -> "GameContent":
        seen: set[str] = set()
        for item in self.items:
            key = item.term.lower()
            if key in seen:
                raise ValueError(f"duplicate term: {item.term!r}")
            seen.add(key)
        return self


class CreateGameRequest(BaseModel):
    """Terminal action for game.generate: turn a staged game into a playable session.

    The content is NOT accepted from the client — it is read from the run's pending
    artifact, so the lecturer's click can only create the game the agent actually staged.
    ``content_hash`` is an optional guard so a stale button cannot create a game from a
    preview the lecturer is no longer looking at.
    """

    chat_id: str = Field(min_length=1, max_length=200)
    run_id: str = Field(min_length=1, max_length=200)
    content_hash: str = Field(default="", max_length=128)
    ttl_days: int | None = Field(default=None, ge=1, le=365)
