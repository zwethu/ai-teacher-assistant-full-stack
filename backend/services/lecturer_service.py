"""The allowlist that decides who may enter the teacher app.

Nothing else in the system distinguishes a lecturer from a student: both sign in
with Google and both end up as ordinary Firebase users, so without this list a
student who played a game could open the teacher app and drive the AI agent.

The list is a Firestore collection whose DOCUMENT IDS are lowercased email
addresses. Existence is the grant — the fields are only there for a human
reading the console. Entries are added by hand (console or `scripts/
add_lecturer.py`); nothing seeds it, so an empty collection means "nobody",
never "everybody".

Reads run through the Admin SDK, which is why the security rules can deny the
client every path to this collection: a list of staff addresses is not public,
and a writable one would be a self-promotion button.
"""

from __future__ import annotations

from utils.firestore_client import get_firestore

LECTURERS_COLLECTION = "lecturers"

# The custom claim minted for an allowlisted lecturer. The same string is read
# by utils/deps.require_lecturer, by firestore.rules isLecturer(), and by the
# frontend's AuthContext — change it in all four or in none.
LECTURER_ROLE = "lecturer"


def normalize_email(email: str | None) -> str:
    """Google hands back a lowercase address; a hand-typed one may not be."""
    return (email or "").strip().lower()


def is_lecturer_email(email: str | None) -> bool:
    """True if this address is on the allowlist.

    Deliberately not exception-safe: if Firestore is unreachable the error
    propagates and the caller's failure path denies the sign-in. Failing open
    here would mean an outage silently grants everyone teacher access.
    """
    normalized = normalize_email(email)
    if not normalized:
        return False
    snapshot = get_firestore().collection(LECTURERS_COLLECTION).document(normalized).get()
    return snapshot.exists
