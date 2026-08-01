"""Phase B backend: game extraction, pending staging, metadata, and the create terminal."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from entity.GameSession import CreateGameRequest, UpdateGameRequest
from routers.agent import _PENDING_ARTIFACT_WORKFLOWS, _WEEK_REQUIRED_WORKFLOWS
from services.agent_gateway import (
    _pending_artifact_message_metadata,
    extract_game_full_from_state,
    maybe_store_pending_artifact_from_session,
)
from services.artifact_service import render_preview_markdown
from services.game_service import (
    GameConflictError,
    GameEligibilityError,
    create_game_from_pending,
    update_game,
)

_ITEMS = [
    {"term": "Photosynthesis", "definition": "Converting light into chemical energy"},
    {"term": "Chlorophyll", "definition": "The green pigment that absorbs light"},
    {"term": "Stomata", "definition": "Pores that allow gas exchange"},
    {"term": "Xylem", "definition": "Tissue that transports water upward"},
]

_GAME_FULL = {"title": "Plant Biology", "items": _ITEMS, "staged_in_run": "run-1"}


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def test_extract_game_requires_matching_run():
    assert extract_game_full_from_state({"game_full": _GAME_FULL}, "run-1") is not None
    # A game staged on an earlier turn must not resurface on a later run.
    assert extract_game_full_from_state({"game_full": _GAME_FULL}, "run-2") is None


def test_extract_game_rejects_other_artifact_types():
    state = {"active_artifact_type": "lesson_plan", "game_full": _GAME_FULL}
    assert extract_game_full_from_state(state, "run-1") is None


def test_extract_game_drops_blank_and_duplicate_pairs():
    state = {
        "game_full": {
            "title": "Plant Biology",
            "items": [
                *_ITEMS,
                {"term": "Xylem", "definition": "duplicate term"},
                {"term": "", "definition": "no term"},
                {"term": "Phloem", "definition": ""},
            ],
            "staged_in_run": "run-1",
        }
    }
    extracted = extract_game_full_from_state(state, "run-1")
    assert extracted is not None
    assert [item["term"] for item in extracted["items"]] == [
        "Photosynthesis", "Chlorophyll", "Stomata", "Xylem",
    ]


def test_extract_game_rejects_too_few_pairs():
    state = {"game_full": {"title": "T", "items": _ITEMS[:3], "staged_in_run": "run-1"}}
    assert extract_game_full_from_state(state, "run-1") is None


def test_extract_game_requires_title():
    state = {"game_full": {"title": "  ", "items": _ITEMS, "staged_in_run": "run-1"}}
    assert extract_game_full_from_state(state, "run-1") is None


# ---------------------------------------------------------------------------
# Pending staging + message metadata
# ---------------------------------------------------------------------------

def test_pending_game_needs_no_week():
    with patch("services.agent_gateway.mark_agent_run_pending_artifact") as marker:
        pending = maybe_store_pending_artifact_from_session(
            batch_id="batch-1",
            lecturer_id="lecturer-1",
            chat_id="chat-1",
            run_id="run-1",
            state={"game_full": _GAME_FULL},
            rendered_markdown="here is your game",
            lecturer_email="teacher@example.com",
            workflow_type="game.generate",
            requested_week=None,
        )
    assert pending is not None
    assert pending["artifact_type"] == "game"
    assert pending["week"] is None
    assert pending["content_json"]["title"] == "Plant Biology"
    assert "Plant Biology" in pending["preview_markdown"]
    assert marker.called


def test_pending_game_skipped_when_run_did_not_stage_it():
    with patch("services.agent_gateway.mark_agent_run_pending_artifact") as marker:
        pending = maybe_store_pending_artifact_from_session(
            batch_id="batch-1",
            lecturer_id="lecturer-1",
            chat_id="chat-1",
            run_id="run-9",
            state={"game_full": _GAME_FULL},
            rendered_markdown="text",
            lecturer_email="teacher@example.com",
            workflow_type="game.generate",
            requested_week=None,
        )
    assert pending is None
    assert not marker.called


def test_pending_metadata_game_is_savable_not_exportable():
    md = _pending_artifact_message_metadata(
        {
            "pending_artifact_id": "pending_run_1",
            "artifact_type": "game",
            "title": "Plant Biology",
            "content_hash": "abc",
            "week": None,
            "content_json": {"title": "Plant Biology", "items": _ITEMS},
        }
    )
    assert md["pending_savable_game"] is True
    assert md["pending_exportable"] is False
    assert md["pending_savable_blueprint"] is False
    assert md["pending_export_target"] == "game"
    assert md["game_item_count"] == 4


def test_render_preview_markdown_game():
    markdown, version = render_preview_markdown(
        "game", {"title": "Plant Biology", "items": _ITEMS}, "fallback"
    )
    assert "Plant Biology" in markdown
    assert "4 term/definition pairs" in markdown
    assert version == "game_markdown.v1"


def test_game_is_pending_artifact_workflow_but_not_week_required():
    assert "game.generate" in _PENDING_ARTIFACT_WORKFLOWS
    assert "game.generate" not in _WEEK_REQUIRED_WORKFLOWS


# ---------------------------------------------------------------------------
# Create terminal
# ---------------------------------------------------------------------------

def _pending(**overrides):
    return {
        "pending_artifact_id": "pending_run-1",
        "artifact_type": "game",
        "title": "Plant Biology",
        "content_hash": "hash-1",
        "content_json": {"title": "Plant Biology", "items": _ITEMS},
        **overrides,
    }


def _request(**overrides):
    return CreateGameRequest(chat_id="chat-1", run_id="run-1", **overrides)


def _create_capturing_write(request: CreateGameRequest) -> dict:
    """Run a create against a stub collection and hand back the document it wrote."""
    claim = {"state": "claimed", "pending_artifact": _pending(), "export_lock_id": "L"}
    written: dict = {}

    class _Ref:
        id = "game_abc"

        def set(self, data):
            written.update(data)

        def get(self):
            return type("Snap", (), {"to_dict": lambda _self: dict(written)})()

    class _Col:
        def document(self, _doc_id):
            return _Ref()

    with (
        patch("services.game_service.claim_pending_artifact_export", return_value=claim),
        patch("services.game_service.mark_agent_run_pending_artifact_exported"),
        patch("services.game_service._games_col", return_value=_Col()),
    ):
        create_game_from_pending("batch-1", "lecturer-1", request)
    return written


def test_create_game_rejects_non_game_pending():
    claim = {"state": "claimed", "pending_artifact": _pending(artifact_type="quiz"), "export_lock_id": "L"}
    with patch("services.game_service.claim_pending_artifact_export", return_value=claim):
        with pytest.raises(GameEligibilityError):
            create_game_from_pending("batch-1", "lecturer-1", _request())


def test_create_game_rejects_stale_content_hash():
    claim = {"state": "claimed", "pending_artifact": _pending(), "export_lock_id": "L"}
    with (
        patch("services.game_service.claim_pending_artifact_export", return_value=claim),
        patch("services.game_service.mark_agent_run_pending_artifact_export_failed") as release,
    ):
        with pytest.raises(GameConflictError):
            create_game_from_pending("batch-1", "lecturer-1", _request(content_hash="stale"))
    # The lock is handed back so the lecturer can retry after regenerating.
    assert release.called


def test_create_game_conflicts_while_in_progress():
    claim = {"state": "in_progress", "pending_artifact": _pending(), "export_lock_id": "L"}
    with patch("services.game_service.claim_pending_artifact_export", return_value=claim):
        with pytest.raises(GameConflictError):
            create_game_from_pending("batch-1", "lecturer-1", _request())


def test_create_game_writes_the_documented_document_shape():
    written = _create_capturing_write(_request())

    assert written["batchId"] == "batch-1"
    # The player app only opens a session whose status is exactly "open".
    assert written["status"] == "open"
    # Flat per-mode play counters, with these exact spellings ("ropelink", not rope_link).
    assert written["gameModeStats"] == {"bucket": 0, "matching": 0, "ropelink": 0}
    # Every card carries a backend-assigned id the player app can key progress on.
    assert [item["id"] for item in written["items"]] == ["item_1", "item_2", "item_3", "item_4"]
    assert written["items"][0]["term"] == "Photosynthesis"
    # Ownership is enforced on every read, so the doc must carry the owner.
    assert written["lecturerId"] == "lecturer-1"
    assert "expiresAt" in written and "createdAt" in written


def test_create_game_without_a_deadline_leaves_it_unset():
    """No deadline is the default: the game stays open until closed or retired."""
    written = _create_capturing_write(_request())
    assert written["deadlineAt"] is None


def test_create_game_stores_the_deadline_and_outlives_it():
    """The record's TTL must never retire a game students may still play."""
    deadline = datetime.now(timezone.utc) + timedelta(days=90)
    written = _create_capturing_write(_request(deadline_at=deadline))

    assert written["deadlineAt"] == deadline
    # Default TTL is 30 days — far short of a 90-day deadline, so it has to stretch.
    assert written["expiresAt"] > deadline


def test_deadline_in_the_past_is_rejected():
    with pytest.raises(ValidationError):
        _request(deadline_at=datetime.now(timezone.utc) - timedelta(minutes=1))


def test_naive_deadline_is_read_as_utc_not_server_local():
    """A missing offset must not silently shift the deadline by the host's zone."""
    naive = (datetime.now(timezone.utc) + timedelta(days=1)).replace(tzinfo=None)
    assert _request(deadline_at=naive).deadline_at == naive.replace(tzinfo=timezone.utc)


def test_update_rejects_an_empty_change():
    with pytest.raises(ValidationError):
        UpdateGameRequest()


def test_update_rejects_setting_and_clearing_at_once():
    with pytest.raises(ValidationError):
        UpdateGameRequest(
            deadline_at=datetime.now(timezone.utc) + timedelta(days=1), clear_deadline=True
        )


def test_update_extending_the_deadline_pushes_the_expiry_out():
    deadline = datetime.now(timezone.utc) + timedelta(days=120)
    updates: dict = {}

    class _Ref:
        def update(self, data):
            updates.update(data)

    class _Col:
        def document(self, _doc_id):
            return _Ref()

    existing = {"gameId": "game_abc", "expiresAt": "2026-09-01T00:00:00+00:00"}
    with (
        patch("services.game_service._games_col", return_value=_Col()),
        patch("services.game_service.get_game", return_value=existing),
    ):
        update_game("game_abc", "lecturer-1", UpdateGameRequest(deadline_at=deadline))

    assert updates["deadlineAt"] == deadline
    assert updates["expiresAt"] > deadline


def test_update_clearing_the_deadline_leaves_the_expiry_alone():
    updates: dict = {}

    class _Ref:
        def update(self, data):
            updates.update(data)

    class _Col:
        def document(self, _doc_id):
            return _Ref()

    with (
        patch("services.game_service._games_col", return_value=_Col()),
        patch("services.game_service.get_game", return_value={"gameId": "game_abc"}),
    ):
        update_game("game_abc", "lecturer-1", UpdateGameRequest(clear_deadline=True))

    assert updates["deadlineAt"] is None
    assert "expiresAt" not in updates


def test_content_hash_ignores_backend_assigned_item_ids():
    claim = {"state": "claimed", "pending_artifact": _pending(), "export_lock_id": "L"}
    hashes = []

    class _Ref:
        id = "game_abc"

        def set(self, data):
            hashes.append(data["contentHash"])

        def get(self):
            return type("Snap", (), {"to_dict": lambda _self: {}})()

    class _Col:
        def document(self, _doc_id):
            return _Ref()

    with (
        patch("services.game_service.claim_pending_artifact_export", return_value=claim),
        patch("services.game_service.mark_agent_run_pending_artifact_exported"),
        patch("services.game_service._games_col", return_value=_Col()),
    ):
        create_game_from_pending("batch-1", "lecturer-1", _request())
        create_game_from_pending("batch-1", "lecturer-1", _request())

    # Same extracted pairs must hash identically across creates.
    assert hashes[0] == hashes[1]


def test_create_game_rejects_invalid_staged_content():
    claim = {
        "state": "claimed",
        "pending_artifact": _pending(content_json={"title": "T", "items": _ITEMS[:2]}),
        "export_lock_id": "L",
    }
    with (
        patch("services.game_service.claim_pending_artifact_export", return_value=claim),
        patch("services.game_service.mark_agent_run_pending_artifact_export_failed"),
    ):
        with pytest.raises(GameEligibilityError):
            create_game_from_pending("batch-1", "lecturer-1", _request())
