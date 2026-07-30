"""Replace the `items` array of a gameSessions document.

The game deals items in pages of 6 (PAGE_SIZE in frontend CatGame.tsx), so a
30-item session plays as 5 rounds of 6.

Nothing else in this project writes gameSessions.items — the docs are created by
hand in the Firebase console — so this script is the supported way to load a
question set. It uses the Admin SDK (same service account as the backend), which
bypasses Firestore rules.

Usage, from the `backend/` directory:

    # See what would change — always do this first. Writes nothing.
    .venv/Scripts/python scripts/seed_game_session.py <assessmentId> \
        --items scripts/items/project_management.json --dry-run

    # Apply it.
    .venv/Scripts/python scripts/seed_game_session.py <assessmentId> \
        --items scripts/items/project_management.json --yes

The items file is a JSON array of {"id", "term", "definition"} objects.
Only the `items` field is touched; batchId / status / createdAt / expiresAt /
gameModeStats are left alone.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Import the backend's own Firebase helpers (this file lives in backend/scripts/).
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# The Windows console defaults to cp1252, which can't encode the arrows and
# curly quotes that show up in item text.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv  # noqa: E402
from google.cloud.firestore_v1.base_query import FieldFilter  # noqa: E402

from utils.firestore_client import get_firestore  # noqa: E402

COLLECTION = "gameSessions"
PAGE_SIZE = 6  # keep in sync with PAGE_SIZE in frontend/src/components/cat/CatGame.tsx


def load_items(path: Path) -> list[dict[str, str]]:
    """Read and validate the items file. Raises ValueError on bad data."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"Items file not found: {path}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path} is not valid JSON: {exc}")

    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{path} must contain a non-empty JSON array")

    seen_ids: set[str] = set()
    items: list[dict[str, str]] = []
    for i, entry in enumerate(raw):
        where = f"{path.name}[{i}]"
        if not isinstance(entry, dict):
            raise ValueError(f"{where} is not an object")

        extra = set(entry) - {"id", "term", "definition"}
        if extra:
            raise ValueError(f"{where} has unexpected key(s): {', '.join(sorted(extra))}")

        for field in ("id", "term", "definition"):
            value = entry.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{where} needs a non-empty string '{field}'")

        item_id = entry["id"].strip()
        if item_id in seen_ids:
            # Item ids are the answer keys (AnswerRecord.questionId); duplicates
            # would silently merge two questions into one score.
            raise ValueError(f"{where} reuses id {item_id!r} — ids must be unique")
        seen_ids.add(item_id)

        items.append(
            {
                "id": item_id,
                "term": entry["term"].strip(),
                "definition": entry["definition"].strip(),
            }
        )

    return items


def describe(items: list[dict[str, str]]) -> str:
    pages = (len(items) + PAGE_SIZE - 1) // PAGE_SIZE
    leftover = len(items) % PAGE_SIZE
    note = "" if leftover == 0 else f" (last round has only {leftover})"
    return f"{len(items)} items → {pages} round(s) of {PAGE_SIZE}{note}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Replace a game session's items.")
    parser.add_argument("assessment_id", help="gameSessions document id")
    parser.add_argument("--items", required=True, type=Path, help="Path to items JSON")
    parser.add_argument("--dry-run", action="store_true", help="Show changes, write nothing")
    parser.add_argument("--yes", action="store_true", help="Confirm the write")
    args = parser.parse_args()

    load_dotenv(BACKEND_DIR / ".env")
    if not (os.getenv("FIREBASE_SERVICE_ACCOUNT") or "").strip():
        print("FIREBASE_SERVICE_ACCOUNT is not set (expected in backend/.env)", file=sys.stderr)
        return 1

    try:
        items = load_items(args.items)
    except ValueError as exc:
        print(f"Invalid items file: {exc}", file=sys.stderr)
        return 1

    db = get_firestore()
    ref = db.collection(COLLECTION).document(args.assessment_id)
    snap = ref.get()
    if not snap.exists:
        # Creating the doc here would produce a session with no batchId, which
        # the play flow needs — so refuse rather than write a broken one.
        print(
            f"No {COLLECTION}/{args.assessment_id} document.\n"
            "Create it in the Firebase console first (it needs batchId + status).",
            file=sys.stderr,
        )
        return 1

    current = snap.to_dict() or {}
    old_items = current.get("items") or []

    print(f"Document : {COLLECTION}/{args.assessment_id}")
    print(f"  batch  : {current.get('batchId')}   status: {current.get('status')}")
    print(f"  before : {describe(old_items)}")
    print(f"  after  : {describe(items)}")
    print()
    for item in items[:3]:
        print(f"    {item['id']:>3}. {item['term']} → {item['definition']}")
    if len(items) > 3:
        print(f"    ... and {len(items) - 3} more")
    print()

    # Existing attempts were scored against the OLD questions. Swapping items
    # doesn't rewrite them, so their score/accuracy will refer to questions that
    # no longer exist.
    attempts = list(
        db.collection("attempts")
        .where(filter=FieldFilter("assessmentId", "==", args.assessment_id))
        .limit(5)
        .stream()
    )
    if attempts:
        print(
            f"  WARNING: {len(attempts)}+ existing attempt(s) were scored on the old\n"
            "           questions. Their saved scores won't match the new set.\n"
        )

    if args.dry_run:
        print("Dry run — nothing written.")
        return 0

    if not args.yes:
        print("Refusing to overwrite without --yes. Re-run with --dry-run to preview.", file=sys.stderr)
        return 1

    ref.update({"items": items})
    print(f"Updated. {describe(items)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
