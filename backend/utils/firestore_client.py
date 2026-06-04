from firebase_admin import firestore

from utils.firebase_auth import init_firebase

_client: firestore.Client | None = None


def get_firestore() -> firestore.Client:
    """Return the shared Firestore client (initializes Firebase Admin if needed)."""
    global _client
    if _client is None:
        init_firebase()
        _client = firestore.client()
    return _client


def __getattr__(name: str):
    if name == "db":
        return get_firestore()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["get_firestore", "db"]
