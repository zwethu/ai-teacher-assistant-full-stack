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
    TTL_GRACE_DAYS_AFTER_DEADLINE,
    CreateGameRequest,
    GameContent,
    UpdateGameRequest,
)
from services.agent_sessions import (
    claim_pending_artifact_export,
    mark_agent_run_pending_artifact_export_failed,
    mark_agent_run_pending_artifact_exported,
)
from services.chat_service import update_assistant_message_metadata_for_run
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
    for key in ("createdAt", "updatedAt", "expiresAt", "deadlineAt"):
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


def _expiry_for(
    now: datetime, ttl_days: int | None, deadline_at: datetime | None
) -> datetime:
    """When the record retires — never before students stop being allowed to play.

    The TTL is about storage, the deadline is about teaching, and a lecturer who sets a
    due date two months out should not silently lose the game after the default 30 days.
    """
    expires_at = now + timedelta(days=ttl_days or DEFAULT_GAME_TTL_DAYS)
    if deadline_at:
        floor = deadline_at + timedelta(days=TTL_GRACE_DAYS_AFTER_DEADLINE)
        expires_at = max(expires_at, floor)
    return expires_at


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

    now = datetime.now(timezone.utc)
    expires_at = _expiry_for(now, payload.ttl_days, payload.deadline_at)
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
        # The player app gates entry on exactly this spelling (open|closed|expired);
        # anything else renders as "Not Available" to every student.
        "status": "open",
        # When the lecturer wants play to stop. None means "no deadline" — the game
        # stays open until it is closed by hand or its TTL retires it.
        "deadlineAt": payload.deadline_at,
        # Hashed from the content only — item ids are backend-assigned, so including them
        # would make the same extracted game hash differently on every create.
        "contentHash": _hash_content({"title": content.title, "items": content_items}),
        "createdAt": SERVER_TIMESTAMP,
        "updatedAt": SERVER_TIMESTAMP,
        "expiresAt": expires_at,
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

    try:
        # The Docs/Forms exports stamp their result onto the assistant message, and the
        # generation stepper reads that metadata to decide the run is finished. Without
        # this the preview card stays savable and the workflow never leaves step 3.
        update_assistant_message_metadata_for_run(
            batch_id=batch_id,
            chat_id=payload.chat_id,
            run_id=payload.run_id,
            metadata={
                "game_id": game_ref.id,
                "game_item_count": len(items),
                "pending_savable_game": False,
                "pending_exportable": False,
            },
        )
    except Exception:
        logger.exception(
            "Game created but assistant message metadata update failed run_id=%s game_id=%s",
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


def update_game(
    game_id: str, lecturer_id: str, payload: UpdateGameRequest
) -> dict[str, Any]:
    """Extend, drop, or enforce a game's deadline, and open or close it by hand."""
    existing = get_game(game_id, lecturer_id)

    updates: dict[str, Any] = {"updatedAt": SERVER_TIMESTAMP}
    if payload.clear_deadline:
        updates["deadlineAt"] = None
    elif payload.deadline_at is not None:
        updates["deadlineAt"] = payload.deadline_at
        # An extension past the old retirement date must carry the record with it.
        updates["expiresAt"] = _expiry_for(
            datetime.now(timezone.utc), None, payload.deadline_at
        )
        existing_expiry = existing.get("expiresAt")
        if isinstance(existing_expiry, str) and existing_expiry > updates["expiresAt"].isoformat():
            del updates["expiresAt"]
    if payload.status is not None:
        updates["status"] = payload.status

    _games_col().document(game_id).update(updates)
    logger.info(
        "game updated game_id=%s lecturer=%s fields=%s",
        game_id,
        lecturer_id,
        sorted(k for k in updates if k != "updatedAt"),
    )
    return get_game(game_id, lecturer_id)


def delete_game(game_id: str, lecturer_id: str) -> dict[str, Any]:
    game = get_game(game_id, lecturer_id)
    _games_col().document(game_id).delete()
    return {"gameId": game["gameId"], "deleted": True}


# ─── Results export ─────────────────────────────────────────────────────────
# One CSV per game session, for a lecturer who wants the marks in a spreadsheet.
#
# The join is deliberately shallow: an attempt carries the student's email,
# nickname and medal because the player app copies them in at write time. The
# alternative — reading players/{uid} per student on every export — costs a read
# per student and needs rules letting a lecturer read every player profile, a
# far wider door than a download button is worth.
#
# Rows come from the ROSTER, not from the attempts. A lecturer's real question
# is "who still has not played", and an attempts-only export cannot answer it.

ATTEMPTS_COLLECTION = "attempts"

RESULT_COLUMNS = [
    # Who
    "batch_name",
    "email",
    "roster_name",
    "oauth_name",
    "nickname",
    "played",
    # What they picked
    "game_mode",
    "avatar",
    # Outcome
    "medal",
    "correct_count",
    "total_questions",
    # Final correctness. A round only clears when everything on it is right, so
    # for anyone who finished this is 100 by construction — it measures whether
    # they got there, not how well they played. Kept because it is what the
    # medal reads and what the student was shown, and because it IS meaningful
    # for a student who ran out of time.
    "accuracy_percent",
    # How many they had right on the FIRST attempt at each round, before the
    # feedback told them anything. This is the "did they know it" number.
    "first_try_accuracy_percent",
    # Correct items against every item they ever submitted wrong. Punishes
    # repeated guessing at the same pair, which first-try accuracy does not.
    "trial_accuracy_percent",
    # Effort, whole game
    "total_trials",
    "total_wrong_submits",
    "total_wrong_pairs",
    # Time, whole game. `wall_clock` is real start→finish time and is the only
    # field that survives a student closing the page and returning later (the
    # AFK counter dies with the page; the wall clock comes from the server).
    "time_limit_seconds",
    "wall_clock_seconds",
    "play_seconds",
    "total_afk_seconds",
    "afk_count",
    "planning_seconds",
    "timed_out",
    # Per round, in play order. Rounds vary from one game to seven, so these are
    # ordered lists rather than seven sets of padded columns. Excel splits them
    # with Text to Columns; the totals above mean nobody has to.
    "rounds_cleared",
    "rounds_total",
    "round_trials",
    "round_wrong_submits",
    "round_wrong_pairs",
    "round_seconds",
    "round_afk_seconds",
    # Every gap between one submit and the next, whole game, in order. This is
    # the planning-time signal the strategy work reads: a long gap is thinking
    # or leaving, and `round_afk_seconds` says which.
    "submit_gaps_seconds",
    # How long after being told something was wrong before they touched anything.
    # The gap above contains this plus the rework; separating them is what tells
    # "read the feedback" apart from "immediately tried again".
    "review_count",
    "avg_review_seconds",
    "completed_at",
]


def _seconds(value: Any) -> str:
    """Milliseconds to whole seconds. Spreadsheets sort numbers, not '3m 20s'."""
    if not isinstance(value, (int, float)):
        return ""
    return str(round(value / 1000))


def _seconds_1dp(value: Any) -> str:
    """For short durations where whole seconds would round away the signal —
    a 0.4s reaction and a 1.4s one are not the same behaviour."""
    if not isinstance(value, (int, float)):
        return ""
    return f"{value / 1000:.1f}"


def _list(values: list[Any], to_text) -> str:
    """Per-round values as one ordered cell: `52;37;41` is round 1, 2, 3."""
    return ";".join(to_text(value) for value in values)


def _result_row(
    student: dict[str, Any],
    attempt: dict[str, Any] | None,
    total_questions: int,
    batch_name: str,
) -> dict[str, str]:
    row = {column: "" for column in RESULT_COLUMNS}
    row["batch_name"] = batch_name
    row["email"] = str(student.get("email") or "")
    row["roster_name"] = str(student.get("name") or "")
    row["total_questions"] = str(total_questions)

    if not attempt:
        # A blank row rather than no row: this is how the lecturer sees who to chase.
        row["played"] = "no"
        return row

    behavior = attempt.get("behavior") or {}
    rounds = [entry for entry in (behavior.get("rounds") or []) if isinstance(entry, dict)]
    completed = attempt.get("completedAt")

    row["played"] = "yes"
    row["nickname"] = str(attempt.get("nickname") or "")
    row["oauth_name"] = str(attempt.get("oauthName") or "")
    row["medal"] = str(attempt.get("medalTier") or "")
    row["correct_count"] = str(attempt.get("score") if attempt.get("score") is not None else "")
    row["accuracy_percent"] = str(
        attempt.get("accuracy") if attempt.get("accuracy") is not None else ""
    )
    row["game_mode"] = str(attempt.get("chosenGameMode") or "")
    row["avatar"] = str(attempt.get("chosenAvatar") or "")

    # First-attempt accuracy, over the rounds they actually reached. Rounds the
    # clock cut off before a single submit are excluded rather than scored zero:
    # never seeing a board is not the same as getting it wrong.
    attempted_items = 0
    first_try_wrong = 0
    for entry in rounds:
        submissions = entry.get("submissions") or []
        if not submissions:
            continue
        attempted_items += int(entry.get("itemCount") or 0)
        first_try_wrong += int(submissions[0].get("wrongCount") or 0)
    if attempted_items:
        row["first_try_accuracy_percent"] = str(
            round((attempted_items - first_try_wrong) / attempted_items * 100)
        )

    # Every wrong item counts again each time it is resubmitted wrong, so a
    # student who guesses at the same pair five times scores below one who missed
    # five different pairs once.
    wrong_pairs = behavior.get("totalWrongLinksOrPairs")
    if isinstance(wrong_pairs, int) and total_questions:
        row["trial_accuracy_percent"] = str(
            round(total_questions / (total_questions + wrong_pairs) * 100)
        )

    row["total_trials"] = str(behavior.get("submitCount", ""))
    row["total_wrong_submits"] = str(behavior.get("wrongSubmitCount", ""))
    row["total_wrong_pairs"] = str(behavior.get("totalWrongLinksOrPairs", ""))

    row["play_seconds"] = _seconds(behavior.get("activePlayMs"))
    row["wall_clock_seconds"] = _seconds(behavior.get("elapsedSinceStartMs"))
    row["total_afk_seconds"] = _seconds(behavior.get("awayMs"))
    row["afk_count"] = str(behavior.get("awayCount", ""))
    row["time_limit_seconds"] = _seconds(behavior.get("timeLimitMs"))
    # Board shown → first touch. Null means they never acted, which is NOT
    # "acted instantly", so it stays blank rather than becoming 0.
    row["planning_seconds"] = _seconds_1dp(behavior.get("firstActionDelayMs"))
    row["timed_out"] = "yes" if behavior.get("timedOut") else "no"

    row["rounds_cleared"] = str(behavior.get("roundsCompleted", ""))
    row["rounds_total"] = str(behavior.get("totalRounds", ""))
    row["round_trials"] = _list(rounds, lambda r: str(r.get("submitCount", "")))
    row["round_wrong_submits"] = _list(rounds, lambda r: str(r.get("wrongSubmitCount", "")))
    row["round_wrong_pairs"] = _list(rounds, lambda r: str(r.get("totalWrongLinksOrPairs", "")))
    row["round_seconds"] = _list(rounds, lambda r: _seconds(r.get("durationMs")))
    row["round_afk_seconds"] = _list(rounds, lambda r: _seconds(r.get("awayMs")))

    # Flattened across rounds in play order: the gap before each submit, which is
    # the time spent working out that attempt.
    gaps = [
        submission.get("durationMs")
        for entry in rounds
        for submission in (entry.get("submissions") or [])
        if isinstance(submission, dict)
    ]
    row["submit_gaps_seconds"] = _list(gaps, _seconds_1dp)

    # An array cannot be a spreadsheet cell, so the review pauses become a count
    # and a mean.
    reviews = [
        value
        for value in (behavior.get("reviewTimesMs") or [])
        if isinstance(value, (int, float))
    ]
    row["review_count"] = str(len(reviews))
    if reviews:
        row["avg_review_seconds"] = _seconds_1dp(sum(reviews) / len(reviews))

    row["completed_at"] = completed.isoformat() if hasattr(completed, "isoformat") else ""
    return row


def export_results_csv(game_id: str, lecturer_id: str) -> tuple[str, str]:
    """Return ``(filename, csv_text)`` for one game session's results.

    Raises GameNotFoundError when the game is missing or belongs to someone else —
    ownership is checked by ``get_game``, so this never widens access.
    """
    import csv
    import io
    import re

    from services.batch_service import get_batch, list_students

    game = get_game(game_id, lecturer_id)
    batch_id = str(game.get("batchId") or "")
    total_questions = len(game.get("items") or [])

    # Named on every row so a file that leaves this app still says which class it
    # came from — a bare "results.csv" in a downloads folder does not.
    batch_name = ""
    try:
        batch = get_batch(batch_id, lecturer_id)
        if batch is not None:
            batch_name = " — ".join(
                part for part in (batch.batch_name, batch.course_name) if part
            )
    except Exception:  # noqa: BLE001 — a missing name must not cost the lecturer the export
        logger.warning("Could not read batch name for results export batch_id=%s", batch_id)

    attempts_by_email: dict[str, dict[str, Any]] = {}
    unmatched: list[dict[str, Any]] = []
    for doc in (
        get_firestore()
        .collection(ATTEMPTS_COLLECTION)
        .where("assessmentId", "==", game_id)
        .stream()
    ):
        data = doc.to_dict() or {}
        email = str(data.get("email") or "").strip().lower()
        if email:
            attempts_by_email[email] = data
        else:
            unmatched.append(data)

    rows: list[dict[str, str]] = []
    for student in list_students(batch_id, lecturer_id):
        email = str(student.get("email") or "").strip().lower()
        rows.append(
            _result_row(student, attempts_by_email.pop(email, None), total_questions, batch_name)
        )

    # Anyone who played but is no longer on the roster (unenrolled, or signed in
    # with a different address) still earned a row — dropping them would silently
    # lose real results.
    for leftover in list(attempts_by_email.values()) + unmatched:
        rows.append(
            _result_row(
                {"email": leftover.get("email", ""), "name": ""},
                leftover,
                total_questions,
                batch_name,
            )
        )

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=RESULT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)

    slug = re.sub(r"[^A-Za-z0-9]+", "-", str(game.get("title") or "game")).strip("-").lower()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"{slug or 'game'}-results-{stamp}.csv"

    # Excel reads a BOM-less UTF-8 CSV as the local ANSI codepage, which turns Thai
    # names into mojibake on the machine this is most likely to be opened on.
    return filename, "\ufeff" + buffer.getvalue()
