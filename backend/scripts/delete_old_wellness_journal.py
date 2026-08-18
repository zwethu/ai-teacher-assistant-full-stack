"""One-off: delete the old hand-written wellness journal.

The journal used to be a mood emoji and a notes box, filled in after a
breathing exercise. It is now generated from activity, so `wellness_journal`
is dead data — nothing reads it any more.

This deletes it permanently. There is no undo, so it does not run by accident:

    python scripts/delete_old_wellness_journal.py            # counts only
    python scripts/delete_old_wellness_journal.py --delete   # actually deletes

Run it from `backend/` with the same credentials the API uses.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.firestore_client import get_firestore  # noqa: E402

COLLECTION = "wellness_journal"
BATCH_SIZE = 400


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--delete",
        action="store_true",
        help="perform the deletion (without it, only counts are printed)",
    )
    args = parser.parse_args()

    db = get_firestore()
    docs = list(db.collection(COLLECTION).stream())
    print(f"{COLLECTION}: {len(docs)} document(s)")

    if not docs:
        return 0
    if not args.delete:
        print("Dry run — pass --delete to remove them.")
        return 0

    deleted = 0
    batch = db.batch()
    for index, doc in enumerate(docs, start=1):
        batch.delete(doc.reference)
        if index % BATCH_SIZE == 0:
            batch.commit()
            batch = db.batch()
        deleted += 1
    batch.commit()

    print(f"Deleted {deleted} document(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
