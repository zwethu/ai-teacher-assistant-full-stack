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
            "firstActionDelayMs": 3_100,
            "durationMs": 92_000,
            "activePlayMs": 61_400,
            "elapsedSinceStartMs": 92_000,
            "timeLimitMs": 360_000,
            "submitCount": 4,
            "wrongSubmitCount": 1,
            "totalWrongLinksOrPairs": 5,
            "reviewTimesMs": [4_200, 2_800],
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

    class _Batch:
        batch_name = "Batch 2026"
        course_name = "Software Testing"

    with (
        patch("services.game_service.get_game", return_value=_GAME),
        patch("services.batch_service.get_batch", return_value=_Batch()),
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
    assert absent["roster_name"] == "Pim S."
    assert absent["correct_count"] == ""
    assert absent["medal"] == ""


def test_carries_the_medal_the_student_was_shown_rather_than_recomputing_one():
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th", medalTier="silver", accuracy=60)])

    assert rows[0]["medal"] == "silver"
    assert rows[0]["accuracy_percent"] == "60"


def test_reports_behaviour_in_seconds_so_a_spreadsheet_can_sort_it():
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th")])
    row = rows[0]

    assert row["play_seconds"] == "61"
    assert row["total_trials"] == "4"
    assert row["total_wrong_submits"] == "1"
    assert row["rounds_cleared"] == "1"
    assert row["timed_out"] == "no"
    assert row["total_questions"] == "3"
    assert row["game_mode"] == "matching"
    assert row["avatar"] == "dog"


def test_carries_the_behaviour_signals_the_attempt_document_will_not_outlive():
    # The attempts are disposable; this file is the record. Every stealth signal
    # the game measures has to survive into it.
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th")])
    row = rows[0]

    assert row["planning_seconds"] == "3.1"     # sub-second precision matters here
    assert row["total_wrong_pairs"] == "5"
    assert row["review_count"] == "2"
    assert row["avg_review_seconds"] == "3.5"   # (4.2 + 2.8) / 2
    assert row["time_limit_seconds"] == "360"


def test_exposes_time_away_that_the_capped_duration_hides():
    # 40 minutes of wall clock against a 6-minute limit: the student opened the
    # run, left, and came back. `duration_seconds` is capped and cannot show it.
    _, rows = _export(
        [
            _attempt(
                "somchai@lamduan.mfu.ac.th",
                behavior={
                    "durationMs": 360_000,
                    "activePlayMs": 45_000,
                    "elapsedSinceStartMs": 2_400_000,
                    "timeLimitMs": 360_000,
                    "timedOut": True,
                },
            )
        ]
    )
    row = rows[0]

    assert row["wall_clock_seconds"] == "2400"
    assert row["timed_out"] == "yes"


def test_never_acting_is_blank_rather_than_zero():
    # 0 would read as "answered instantly" — the opposite of what happened.
    _, rows = _export(
        [_attempt("somchai@lamduan.mfu.ac.th", behavior={"firstActionDelayMs": None})]
    )

    assert rows[0]["planning_seconds"] == ""
    assert rows[0]["review_count"] == "0"
    assert rows[0]["avg_review_seconds"] == ""


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
    assert rows[0]["correct_count"] == "3"
    assert rows[0]["play_seconds"] == ""


def test_filename_carries_the_game_title():
    filename, _ = _export([])
    assert filename.startswith("plant-biology-results-")
    assert filename.endswith(".csv")


def test_nobody_played_still_lists_the_whole_class():
    _, rows = _export([])
    assert len(rows) == 2
    assert all(row["played"] == "no" for row in rows)


def _round(index, trials, wrong_subs, wrong_pairs, seconds, afk_seconds, gaps):
    return {
        "roundIndex": index,
        "itemCount": 6,
        "submitCount": trials,
        "wrongSubmitCount": wrong_subs,
        "totalWrongLinksOrPairs": wrong_pairs,
        "durationMs": seconds * 1000,
        "awayMs": afk_seconds * 1000,
        "completed": True,
        "submissions": [
            {"index": i + 1, "durationMs": int(gap * 1000), "clean": i == len(gaps) - 1, "wrongCount": 0}
            for i, gap in enumerate(gaps)
        ],
    }


_THREE_ROUNDS = {
    "submitCount": 6,
    "wrongSubmitCount": 3,
    "totalWrongLinksOrPairs": 7,
    "durationMs": 130_000,
    "activePlayMs": 130_000,
    "elapsedSinceStartMs": 130_000,
    "awayMs": 120_000,
    "awayCount": 1,
    "timeLimitMs": 900_000,
    "firstActionDelayMs": 3_100,
    "roundsCompleted": 3,
    "totalRounds": 3,
    "timedOut": False,
    "rounds": [
        _round(0, 2, 1, 2, 52, 0, [31.0, 19.2]),
        _round(1, 1, 0, 0, 37, 0, [34.8]),
        _round(2, 3, 2, 5, 41, 120, [12.4, 8.1, 18.3]),
    ],
}


def test_per_round_values_are_ordered_lists_one_entry_per_round():
    # Rounds run from one to seven depending on pair count, so seven sets of
    # padded columns would be mostly empty. An ordered list keeps one row per
    # student and loses nothing.
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th", behavior=_THREE_ROUNDS)])
    row = rows[0]

    assert row["round_trials"] == "2;1;3"
    assert row["round_wrong_submits"] == "1;0;2"
    assert row["round_wrong_pairs"] == "2;0;5"
    assert row["round_seconds"] == "52;37;41"


def test_round_totals_agree_with_the_per_round_lists():
    # The totals exist so nobody has to sum a list; they must not disagree with it.
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th", behavior=_THREE_ROUNDS)])
    row = rows[0]

    assert row["total_trials"] == "6" == str(sum(int(v) for v in row["round_trials"].split(";")))
    assert row["total_wrong_submits"] == "3"
    assert row["total_wrong_pairs"] == "7"


def test_every_gap_between_submissions_survives_in_play_order():
    # This is the planning signal: the time spent working out each attempt.
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th", behavior=_THREE_ROUNDS)])

    assert rows[0]["submit_gaps_seconds"] == "31.0;19.2;34.8;12.4;8.1;18.3"


def test_afk_is_reported_per_round_so_a_long_round_can_be_read():
    # Round 3 took 41s with 120s away — the round clock keeps running in a hidden
    # tab, so without the AFK column a long round cannot be told apart from a
    # student who sat and thought.
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th", behavior=_THREE_ROUNDS)])
    row = rows[0]

    assert row["round_afk_seconds"] == "0;0;120"
    assert row["total_afk_seconds"] == "120"
    assert row["afk_count"] == "1"


def test_batch_name_is_on_every_row():
    # A bare results.csv in a downloads folder should still say which class.
    _, rows = _export([_attempt("somchai@lamduan.mfu.ac.th")])
    assert all(row["batch_name"] == "Batch 2026 — Software Testing" for row in rows)


def test_carries_both_the_account_name_and_the_chosen_nickname():
    _, rows = _export(
        [_attempt("somchai@lamduan.mfu.ac.th", oauthName="Somchai Prasert", nickname="Speedy")]
    )

    assert rows[0]["oauth_name"] == "Somchai Prasert"
    assert rows[0]["nickname"] == "Speedy"
    assert rows[0]["roster_name"] == "Somchai P."


def _round_with_first_wrong(index, items, first_wrong, trials):
    return {
        "roundIndex": index,
        "itemCount": items,
        "submitCount": trials,
        "submissions": [
            {"index": n + 1, "durationMs": 10_000, "clean": n == trials - 1,
             "wrongCount": first_wrong if n == 0 else 0}
            for n in range(trials)
        ],
    }


def test_final_accuracy_cannot_tell_a_clean_run_from_a_fixed_one():
    # Documenting the limit, not endorsing it: a round only clears when it is all
    # correct, so `accuracy_percent` is 100 for anyone who finished. It is the
    # number the student saw and the medal read, but it is not a skill measure.
    _, rows = _export(
        [
            _attempt(
                "somchai@lamduan.mfu.ac.th",
                accuracy=100,
                behavior={
                    "totalWrongLinksOrPairs": 4,
                    "rounds": [_round_with_first_wrong(0, 3, 2, 3)],
                },
            )
        ]
    )

    assert rows[0]["accuracy_percent"] == "100"      # finished
    assert rows[0]["first_try_accuracy_percent"] == "33"   # 1 of 3 right unaided
    assert rows[0]["trial_accuracy_percent"] == "43"       # 3 / (3 + 4)


def test_first_try_accuracy_ignores_rounds_the_clock_never_reached():
    # A round with no submissions was never attempted. Scoring it zero would
    # punish a student for a board they never saw.
    _, rows = _export(
        [
            _attempt(
                "somchai@lamduan.mfu.ac.th",
                behavior={
                    "rounds": [
                        _round_with_first_wrong(0, 3, 0, 1),
                        {"roundIndex": 1, "itemCount": 3, "submissions": []},
                    ]
                },
            )
        ]
    )

    # 3 of 3 on the one round they reached, not 3 of 6.
    assert rows[0]["first_try_accuracy_percent"] == "100"
