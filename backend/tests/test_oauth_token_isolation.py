"""WS4-B: the Google OAuth refresh token lives in an Admin-only private subdoc,
never on the client-readable users/{uid} doc, with legacy fallback + migration."""

from google.cloud.firestore import DELETE_FIELD

from services.google_workspace import credentials as cred


# --- minimal dict-backed fake firestore (path-accurate) ------------------------

class _Snap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data else {}


class _Doc:
    def __init__(self, store, path):
        self.store, self.path = store, path

    def get(self):
        return _Snap(self.store.get(self.path))

    def set(self, data, merge=False):
        cur = self.store.get(self.path) or {} if merge else {}
        self.store[self.path] = {**cur, **data}

    def update(self, data):
        cur = self.store.get(self.path) or {}
        for k, v in data.items():
            if v is DELETE_FIELD:
                cur.pop(k, None)
            else:
                cur[k] = v
        self.store[self.path] = cur

    def collection(self, name):
        return _Coll(self.store, f"{self.path}/{name}")


class _Coll:
    def __init__(self, store, path):
        self.store, self.path = store, path

    def document(self, doc_id):
        return _Doc(self.store, f"{self.path}/{doc_id}")


class _DB:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        return _Coll(self.store, name)


_PRIV = "users/u1/private/google_oauth"
_USER = "users/u1"


def test_store_writes_to_private_subdoc_only():
    db = _DB()
    cred.store_refresh_token(db, "u1", "rt-abc")
    assert db.store[_PRIV]["google_refresh_token"] == "rt-abc"
    assert _USER not in db.store  # nothing written to the client-readable doc


def test_read_prefers_private_subdoc():
    db = _DB()
    db.store[_PRIV] = {"google_refresh_token": "rt-priv"}
    assert cred.read_refresh_token(db, "u1") == "rt-priv"


def test_read_migrates_legacy_token_off_user_doc():
    db = _DB()
    db.store[_USER] = {"uid": "u1", "google_refresh_token": "rt-legacy", "email": "a@b.c"}
    token = cred.read_refresh_token(db, "u1")
    assert token == "rt-legacy"
    # migrated into the private subdoc...
    assert db.store[_PRIV]["google_refresh_token"] == "rt-legacy"
    # ...and cleared off the client-readable users doc, other fields intact
    assert "google_refresh_token" not in db.store[_USER]
    assert db.store[_USER]["email"] == "a@b.c"


def test_read_returns_none_when_absent():
    db = _DB()
    db.store[_USER] = {"uid": "u1", "email": "a@b.c"}
    assert cred.read_refresh_token(db, "u1") is None


def test_get_user_google_record_sources_token_from_private(monkeypatch):
    db = _DB()
    db.store[_USER] = {"uid": "u1", "google_scopes": ["s"], "google_token_status": "valid"}
    db.store[_PRIV] = {"google_refresh_token": "rt-priv"}
    monkeypatch.setattr(cred, "get_firestore", lambda: db)
    rec = cred.get_user_google_record("u1")
    assert rec["google_refresh_token"] == "rt-priv"
    assert rec["google_scopes"] == ["s"]
    assert rec["google_token_status"] == "valid"
