"""The lecturer's results CSV for one game session.

The defect these guard: an export built from the attempts alone answers "how did
the students who played do", when the question a lecturer actually has after
sending the link is "who still has not played".
"""

import csv
import io
from unittest.mock import patch

from services.game_service import export_results_csv

_GAME = {
    "gameId": "game_abc",
    "batchId": "batch-1",
    "title": "Plant Biology",
    "items": [{"id": "i1"}, {"id": "i2"}, {"id": "i3"}],
}

_ROSTER = [
    {"email": "somchai@lamduan.mfu.ac.th", "name": "Somchai P."},
    {"email": "pim@lamduan.mfu.ac.th", "name": "Pim S."},
]


def _attempt(email: str, **overrides):
    attempt = {
        "assessmentId": "game_abc",
        "email": email,
        "nickname": "Speedy",
        "medalTier": "gold",
        "score": 3,
        "accuracy": 100,
        "chosenGameMode": "matching",
        "chosenAvatar": "dog",
        "behavior": {
            "durationMs": 92_000,
            "activePlayMs": 61_400,
            "submitCount": 4,
            "wrongSubmitCount": 1,
            "roundsCompleted": 1,
            "totalRounds": 1,
            "timedOut": False,
        },
    }
    attempt.update(overrides)
    return attempt


class _Doc:
    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


def _export(attempts, roster=None):
    """Runs the export against a stubbed Firestore and returns parsed rows."""

    class _Query:
        def where(self, *_args, **_kwargs):
            return self

        def stream(self):
            return [_Doc(item) for item in attempts]

    class _Client:
        def collection(self, _name):
            return _Query()

    with (
        patch("services.game_service.get_game", return_value=_GAME),
        patch("services.game_service.get_firestore", return_value=_Client()),
        patch(
            "services.batch_service.list_students",
            return_value=_ROSTER if roster is None else roster,
        ),
    ):
        filename, text = export_results_csv("game_abc", "lecturer-1")

    assert text.startswith("﻿"), "Excel needs the BOM or Thai names arrive as mojibake"
    return filename, list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))


def test_every_enrolled_student_gets_a_row_played_or_not():
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th")])

    assert [row["email"] for row in rows] == [
        "somchai@lamduan.mfu.ac.th",
        "pim@lamduan.mfu.ac.th",
    ]
    played, absent = rows
    assert played["played"] == "yes"
    # The blank row IS the feature: this is how a lecturer sees who to chase.
    assert absent["played"] == "no"
    assert absent["name"] == "Pim S."
    assert absent["score"] == ""
    assert absent["medal"] == ""


def test_carries_the_medal_the_student_was_shown_rather_than_recomputing_one():
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th", medalTier="silver", accuracy=60)])

    assert rows[0]["medal"] == "silver"
    assert rows[0]["accuracy_percent"] == "60"


def test_reports_behaviour_in_seconds_so_a_spreadsheet_can_sort_it():
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th")])
    row = rows[0]

    assert row["duration_seconds"] == "92"
    assert row["active_play_seconds"] == "61"
    assert row["submissions"] == "4"
    assert row["wrong_submissions"] == "1"
    assert row["rounds_cleared"] == "1"
    assert row["timed_out"] == "no"
    assert row["total_pairs"] == "3"
    assert row["game_mode"] == "matching"
    assert row["avatar"] == "dog"


def test_matches_the_roster_regardless_of_address_casing():
    _, rows = _export([_attempt("Somchai@Lamduan.MFU.ac.th")])

    assert rows[0]["played"] == "yes"
    assert len(rows) == 2, "a case difference must not produce a duplicate row"


def test_keeps_results_from_students_no_longer_on_the_roster():
    # Unenrolled after playing, or signed in with a different address. Dropping
    # the row would silently lose a real result.
    _, rows = _export([_attempt("ghost@lamduan.mfu.ac.th")])

    assert len(rows) == 3
    assert rows[-1]["email"] == "ghost@lamduan.mfu.ac.th"
    assert rows[-1]["played"] == "yes"


def test_an_attempt_with_no_behaviour_still_exports():
    # Attempts written before the behaviour summary existed, or a run that failed
    # to record one — the marks still matter.
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th", behavior=None)])

    assert rows[0]["played"] == "yes"
    assert rows[0]["score"] == "3"
    assert rows[0]["duration_seconds"] == ""


def test_filename_carries_the_game_title():
    filename, _ = _export([])
    assert filename.startswith("plant-biology-results-")
    assert filename.endswith(".csv")


def test_nobody_played_still_lists_the_whole_class():
    _, rows = _export([])
    assert len(rows) == 2
    assert all(row["played"] == "no" for row in rows)
