# Game results CSV — field reference

One file per game session, from the **Results** button on the Games page.
One row per enrolled student — students who never played get a blank row with
`played = no`, so you can see who to chase.

List fields (`round_*`, `submit_gaps_seconds`) are semicolon-separated in play
order: `52;37;41` = round 1, round 2, round 3. Split in Excel with
**Data → Text to Columns**.

## Fields

| Column | Meaning | Example |
|---|---|---|
| `batch_name` | The class | `SE 1204 — Software Quality Assurance` |
| `email` | Sign-in address | `somchai@lamduan.mfu.ac.th` |
| `roster_name` | Name on the class list | `Somchai Prasert` |
| `oauth_name` | Name on their Google account | `Somchai Prasert` |
| `nickname` | Name they typed in the game | `Speedy` |
| `played` | Did they play at all | `yes` |
| `game_mode` | Mode they chose | `matching` |
| `avatar` | Buddy they chose | `cat` |
| `medal` | What the result screen showed them | `gold` |
| `correct_count` | Pairs correct at the end | `30` |
| `total_questions` | Pairs in the game | `30` |
| `accuracy_percent` | correct ÷ total. 100 for anyone who finished | `100` |
| `first_try_accuracy_percent` | Right on the FIRST attempt at each round | `93` |
| `trial_accuracy_percent` | total ÷ (total + every wrong item) | `94` |
| `total_trials` | Times they pressed Submit | `6` |
| `total_wrong_submits` | Submits with at least one mistake | `1` |
| `total_wrong_pairs` | Wrong items across all submits (min mistake = 2, a swap) | `2` |
| `time_limit_seconds` | Time allowed: 30s per pair, min 60 | `900` |
| `wall_clock_seconds` | Real time, start → finish, never pauses | `268` |
| `play_seconds` | Same clock but only while a puzzle was on screen | `262` |
| `total_afk_seconds` | Time the tab was hidden (counted inside play) | `0` |
| `afk_count` | Separate times they left the tab | `0` |
| `planning_seconds` | Pause before the first card touch. Blank = never acted | `8.4` |
| `timed_out` | Did the clock run out | `no` |
| `rounds_cleared` | Rounds finished | `5` |
| `rounds_total` | Rounds in the game | `5` |
| `round_trials` | Submits per round | `1;2;1;1;1` |
| `round_wrong_submits` | Wrong submits per round | `0;1;0;0;0` |
| `round_wrong_pairs` | Wrong items per round | `0;2;0;0;0` |
| `round_seconds` | Time per round | `44;71;49;51;47` |
| `round_afk_seconds` | Tab hidden per round | `0;0;0;0;0` |
| `submit_gaps_seconds` | Time before each submit, whole game in order | `42.1;38.4;26.2;47.0;49.3;45.6` |
| `review_count` | Times they paused after seeing "wrong" | `1` |
| `avg_review_seconds` | How long those pauses were | `6.1` |
| `completed_at` | When they finished (ISO) | `2026-08-01T14:32:07+00:00` |

## The time fields, in one line each

| Field | Is |
|---|---|
| `time_limit_seconds` | The rule — same for every student in a game |
| `wall_clock_seconds` | Everything, start to finish |
| `play_seconds` | Only while a puzzle was open |
| `total_afk_seconds` | Tab hidden — sits INSIDE play, they overlap |

Useful subtractions:

| Question | Formula |
|---|---|
| How long did they actually work? | `play − afk` |
| Were they gone with the page CLOSED? | `wall_clock − play` is large |
| Were they gone with the page OPEN? | `afk` is large |

## Example rows

| Student | Row reads as |
|---|---|
| **Somchai** — trials 6, wrong_pairs 2, planning 8.4, gaps 26–49s, afk 0 | Planner. Thought first, one swap, fixed it |
| **Pim** — trials 19, wrong_pairs 38, planning 0.9, gaps 4–6s, avg_review 0.4 | Trial and error. Guessed fast, ignored feedback |
| **Nok** — round_seconds `46;238;51;220;51`, round_afk `0;181;0;160;0` | Left the tab twice. Real work per round ≈ 57s and 60s — normal |
| **Arun** — played `no`, everything blank | Never opened it. Chase him |

## What this cannot see

- A phone beside the laptop — the tab never hides, reads as slow play
- Two windows side by side — AFK only fires on tab switch or minimise
- *Why* someone left — a message and ChatGPT look identical

Signals worth a conversation, not proof. Read them across the whole class; the
outliers are what matters.
