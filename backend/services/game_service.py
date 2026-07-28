"""Game session persistence — the terminal step of the game.generate workflow.

The game agent only stages content in session state (``game_full``); this module is the
single writer of the ``gameSessions`` collection. It claims the run's pending artifact
using the same lock the Docs/Forms exports use, so a double-clicked "Create game" button
creates one game, not two.

Field naming inside a gameSessions document is camelCase (``expiresAt``,
``gameModeStats``) rather than the snake_case used elsewhere in Firestore — that is the
shape the player client consumes.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from google.cloud.firestore import SERVER_TIMESTAMP
from pydantic import ValidationError

from entity.GameSession import (
    DEFAULT_GAME_TTL_DAYS,
    GAME_MODES,
    CreateGameRequest,
    GameContent,
)
from services.agent_sessions import (
    claim_pending_artifact_export,
    mark_agent_run_pending_artifact_export_failed,
    mark_agent_run_pending_artifact_exported,
)
from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

GAME_SESSIONS_COLLECTION = "gameSessions"


class GameNotFoundError(LookupError):
    pass


class GameConflictError(RuntimeError):
    pass


class GameEligibilityError(ValueError):
    pass


def _games_col():
    return get_firestore().collection(GAME_SESSIONS_COLLECTION)


def _hash_content(content: dict[str, Any]) -> str:
    raw = json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _serialize(doc_id: str, data: dict[str, Any]) -> dict[str, Any]:
    result = {**data, "gameId": str(data.get("gameId") or doc_id)}
    for key in ("createdAt", "updatedAt", "expiresAt"):
        value = result.get(key)
        if hasattr(value, "isoformat"):
            result[key] = value.isoformat()
    return result


def _initial_mode_stats() -> dict[str, int]:
    """Seed a zero play-counter per mode so the player app can increment without a create."""
    return {mode: 0 for mode in GAME_MODES}


def _with_item_ids(items: list[dict[str, str]]) -> list[dict[str, str]]:
    """Give every card a stable id the player app can key per-item progress on.

    Ids are assigned here rather than by the agent: the backend owns every operational
    field on the document, and an agent-supplied id could collide or repeat across runs.
    """
    return [
        {"id": f"item_{index}", "term": item["term"], "definition": item["definition"]}
        for index, item in enumerate(items, start=1)
    ]


def create_game_from_pending(
    batch_id: str,
    lecturer_id: str,
    payload: CreateGameRequest,
) -> dict[str, Any]:
    """Create a playable game from the game staged by ``payload.run_id``.

    The content comes from the run's pending artifact, never from the request, so the
    lecturer's click can only create the game the agent actually staged.
    """
    try:
        claim = claim_pending_artifact_export(
            batch_id=batch_id,
            chat_id=payload.chat_id,
            run_id=payload.run_id,
            lecturer_id=lecturer_id,
        )
    except PermissionError as exc:
        raise GameNotFoundError(str(exc)) from exc
    except RuntimeError as exc:
        raise GameNotFoundError(str(exc)) from exc

    pending = claim.get("pending_artifact") or {}
    if str(pending.get("artifact_type") or "") != "game":
        raise GameEligibilityError("This message does not have a game to create")

    state = claim.get("state")
    if state == "already_exported":
        existing_id = str(pending.get("game_id") or "")
        if existing_id:
            snap = _games_col().document(existing_id).get()
            if snap.exists:
                return {**_serialize(snap.id, snap.to_dict() or {}), "idempotent": True}
        raise GameConflictError("This game was already created")
    if state == "in_progress":
        raise GameConflictError("This game is already being created")

    lock_id = str(claim.get("export_lock_id") or "")

    # A stale preview card must not create a game the lecturer is no longer looking at.
    expected_hash = str(pending.get("content_hash") or "")
    if payload.content_hash and expected_hash and payload.content_hash != expected_hash:
        _release_lock(batch_id, payload, lock_id, "Game content changed since this preview")
        raise GameConflictError("This game preview is out of date — regenerate the game")

    try:
        content = GameContent.model_validate(pending.get("content_json") or {})
    except ValidationError as exc:
        message = f"Staged game is not valid: {exc.errors()[0].get('msg', 'invalid content')}"
        _release_lock(batch_id, payload, lock_id, message)
        raise GameEligibilityError(message) from exc

    ttl_days = payload.ttl_days or DEFAULT_GAME_TTL_DAYS
    now = datetime.now(timezone.utc)
    game_ref = _games_col().document(f"game_{uuid.uuid4().hex[:16]}")
    content_items = [item.model_dump(mode="json") for item in content.items]
    items = _with_item_ids(content_items)
    data = {
        "gameId": game_ref.id,
        "batchId": batch_id,
        # Not in the documented shape, but every read path filters on it — without it any
        # signed-in user could read or delete any lecturer's game.
        "lecturerId": lecturer_id,
        "chatId": payload.chat_id,
        "runId": payload.run_id,
        "sourceArtifactId": str(pending.get("pending_artifact_id") or ""),
        "title": content.title,
        "items": items,
        "itemCount": len(items),
        "modes": list(GAME_MODES),
        "gameModeStats": _initial_mode_stats(),
        "status": "active",
        # Hashed from the content only — item ids are backend-assigned, so including them
        # would make the same extracted game hash differently on every create.
        "contentHash": _hash_content({"title": content.title, "items": content_items}),
        "createdAt": SERVER_TIMESTAMP,
        "updatedAt": SERVER_TIMESTAMP,
        "expiresAt": now + timedelta(days=ttl_days),
    }

    try:
        game_ref.set(data)
    except Exception as exc:
        _release_lock(batch_id, payload, lock_id, f"Game creation failed: {exc}")
        raise

    try:
        mark_agent_run_pending_artifact_exported(
            batch_id=batch_id,
            chat_id=payload.chat_id,
            run_id=payload.run_id,
            pending_artifact={
                **pending,
                "game_id": game_ref.id,
                # mark_..._exported mirrors this into the run's draft_artifact_id.
                "artifact_id": game_ref.id,
            },
        )
    except Exception:
        # The game exists; failing to close the run's lock must not fail the request.
        logger.exception(
            "Game created but run pending-artifact marker failed run_id=%s game_id=%s",
            payload.run_id,
            game_ref.id,
        )

    logger.info(
        "game created game_id=%s batch=%s run_id=%s items=%d",
        game_ref.id,
        batch_id,
        payload.run_id,
        len(items),
    )
    saved = game_ref.get().to_dict() or data
    return {**_serialize(game_ref.id, saved), "idempotent": False}


def _release_lock(
    batch_id: str, payload: CreateGameRequest, lock_id: str, error: str
) -> None:
    """Hand the export lock back so the lecturer can retry after a failed create."""
    if not lock_id:
        return
    try:
        mark_agent_run_pending_artifact_export_failed(
            batch_id=batch_id,
            chat_id=payload.chat_id,
            run_id=payload.run_id,
            error=error,
            export_lock_id=lock_id,
        )
    except Exception:
        logger.exception(
            "Failed to release game export lock run_id=%s", payload.run_id
        )


def get_game(game_id: str, lecturer_id: str) -> dict[str, Any]:
    snap = _games_col().document(game_id).get()
    data = snap.to_dict() or {}
    if not snap.exists or str(data.get("lecturerId") or "") != lecturer_id:
        raise GameNotFoundError("Game not found or access denied")
    return _serialize(snap.id, data)


def list_games(batch_id: str, lecturer_id: str, limit: int = 50) -> list[dict[str, Any]]:
    docs = (
        _games_col()
        .where("batchId", "==", batch_id)
        .where("lecturerId", "==", lecturer_id)
        .limit(limit)
        .stream()
    )
    games = [_serialize(doc.id, doc.to_dict() or {}) for doc in docs]
    games.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
    return games


def delete_game(game_id: str, lecturer_id: str) -> dict[str, Any]:
    game = get_game(game_id, lecturer_id)
    _games_col().document(game_id).delete()
    return {"gameId": game["gameId"], "deleted": True}
