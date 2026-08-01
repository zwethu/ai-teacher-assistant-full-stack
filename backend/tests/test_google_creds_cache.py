"""The per-(uid, scopes) credential cache must reuse valid tokens and never stale ones."""

from __future__ import annotations

import pytest

import services.google_workspace.credentials as creds_mod


class FakeCredentials:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self._valid = False

    def refresh(self, request):
        FakeCredentials.refresh_count += 1
        self._valid = True

    @property
    def valid(self) -> bool:
        return self._valid

    refresh_count = 0


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "csecret")
    monkeypatch.setattr(creds_mod, "Credentials", FakeCredentials)
    monkeypatch.setattr(
        creds_mod,
        "get_user_google_record",
        lambda uid: {"google_refresh_token": "tok"},
    )
    FakeCredentials.refresh_count = 0
    creds_mod._CREDS_CACHE.clear()
    yield
    creds_mod._CREDS_CACHE.clear()


def test_second_build_hits_cache():
    first = creds_mod.build_user_credentials("u1", ["drive.file"])
    second = creds_mod.build_user_credentials("u1", ["drive.file"])
    assert first is second
    assert FakeCredentials.refresh_count == 1


def test_scope_sets_cached_separately_but_order_insensitive():
    creds_mod.build_user_credentials("u1", ["drive.file"])
    creds_mod.build_user_credentials("u1", ["documents", "drive.file"])
    assert FakeCredentials.refresh_count == 2
    creds_mod.build_user_credentials("u1", ["drive.file", "documents"])
    assert FakeCredentials.refresh_count == 2


def test_expired_cached_credentials_are_refreshed_again():
    creds = creds_mod.build_user_credentials("u1", ["drive.file"])
    creds._valid = False
    renewed = creds_mod.build_user_credentials("u1", ["drive.file"])
    assert renewed is not creds
    assert FakeCredentials.refresh_count == 2


def test_clear_user_credentials_cache_scopes_to_uid():
    creds_mod.build_user_credentials("u1", ["drive.file"])
    creds_mod.build_user_credentials("u2", ["drive.file"])
    creds_mod.clear_user_credentials_cache("u1")
    creds_mod.build_user_credentials("u2", ["drive.file"])  # still cached
    assert FakeCredentials.refresh_count == 2
    creds_mod.build_user_credentials("u1", ["drive.file"])  # evicted -> refresh
    assert FakeCredentials.refresh_count == 3


def test_failed_refresh_is_not_cached(monkeypatch):
    def boom(self, request):
        raise RuntimeError("revoked")

    monkeypatch.setattr(FakeCredentials, "refresh", boom)
    monkeypatch.setattr(creds_mod, "get_firestore", lambda: (_ for _ in ()).throw(RuntimeError))
    with pytest.raises(creds_mod.GoogleOAuthInvalidError):
        creds_mod.build_user_credentials("u1", ["drive.file"])
    assert creds_mod._CREDS_CACHE == {}
