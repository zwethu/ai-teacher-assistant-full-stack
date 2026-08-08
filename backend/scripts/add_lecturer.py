"""Add, remove or list entries in the `lecturers` allowlist.

Being on this list is the ONLY thing that lets an account into the teacher app
(see services/lecturer_service.py). The Firebase console works just as well —
this script exists so the address gets normalised the same way the sign-in check
normalises it, which is the one easy way to create an entry that silently never
matches.

Usage, from the `backend/` directory:

    .venv/Scripts/python scripts/add_lecturer.py --list
    .venv/Scripts/python scripts/add_lecturer.py add someone@example.com --note "Physics"
    .venv/Scripts/python scripts/add_lecturer.py remove someone@example.com

Uses the Admin SDK (same credentials as the backend), which bypasses Firestore
rules — those deny the client every path to this collection.

Removing an address stops future sign-ins. It does NOT revoke a session that is
already running: the lecturer claim lives in their ID token until it expires
(about an hour). To cut someone off immediately, also revoke their refresh
tokens in the Firebase console.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Import the backend's own Firebase helpers (this file lives in backend/scripts/).
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv  # noqa: E402
from google.cloud.firestore import SERVER_TIMESTAMP  # noqa: E402

from services.lecturer_service import LECTURERS_COLLECTION, normalize_email  # noqa: E402
from utils.firestore_client import get_firestore  # noqa: E402


def cmd_list() -> int:
    docs = list(get_firestore().collection(LECTURERS_COLLECTION).stream())
    if not docs:
        print("The allowlist is EMPTY — nobody can sign into the teacher app.")
        return 0
    print(f"{len(docs)} lecturer(s):")
    for doc in sorted(docs, key=lambda d: d.id):
        note = (doc.to_dict() or {}).get("note") or ""
        print(f"  {doc.id}{f'   — {note}' if note else ''}")
    return 0


def cmd_add(email: str, note: str) -> int:
    normalized = normalize_email(email)
    if "@" not in normalized:
        print(f"Not an email address: {email!r}")
        return 1
    ref = get_firestore().collection(LECTURERS_COLLECTION).document(normalized)
    if ref.get().exists:
        print(f"Already on the list: {normalized}")
        return 0
    ref.set({"email": normalized, "note": note, "addedAt": SERVER_TIMESTAMP})
    print(f"Added {normalized}.")
    print("They must sign out and sign in again to pick up the lecturer role.")
    return 0


def cmd_remove(email: str) -> int:
    normalized = normalize_email(email)
    ref = get_firestore().collection(LECTURERS_COLLECTION).document(normalized)
    if not ref.get().exists:
        print(f"Not on the list: {normalized}")
        return 0
    ref.delete()
    print(f"Removed {normalized}.")
    print("Their current session lasts until the ID token expires (~1 hour);")
    print("revoke their refresh tokens in the Firebase console to cut it now.")
    return 0


def main() -> int:
    load_dotenv(BACKEND_DIR / ".env", override=True)

    parser = argparse.ArgumentParser(description="Manage the lecturer allowlist.")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("list", help="show every allowlisted address")
    add = sub.add_parser("add", help="allow an address into the teacher app")
    add.add_argument("email")
    add.add_argument("--note", default="", help="free text, for whoever reads the console")
    remove = sub.add_parser("remove", help="revoke an address")
    remove.add_argument("email")
    parser.add_argument("--list", action="store_true", help="alias for the list command")

    args = parser.parse_args()
    if args.list or args.command == "list" or args.command is None:
        return cmd_list()
    if args.command == "add":
        return cmd_add(args.email, args.note)
    if args.command == "remove":
        return cmd_remove(args.email)
    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
