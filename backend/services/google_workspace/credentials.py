"""Central credential management for Google Workspace APIs.

This is the **only** module that reads ``users/{uid}.google_refresh_token``
from Firestore.  No refresh token or access token is ever returned to callers
outside the backend service layer.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials

from utils.firestore_client import get_firestore

logger = logging.getLogger(__name__)

USERS_COLLECTION = "users"

# ---------------------------------------------------------------------------
# Scope maps
# ---------------------------------------------------------------------------

GOOGLE_WORKSPACE_SCOPES_BY_PRODUCT: dict[str, list[str]] = {
    "documents": [
        "https://www.googleapis.com/auth/documents",
    ],
    "drive.file": [
        "https://www.googleapis.com/auth/drive.file",
    ],
    "forms.body": [
        "https://www.googleapis.com/auth/forms.body",
    ],
    "forms.responses.readonly": [
        "https://www.googleapis.com/auth/forms.responses.readonly",
    ],
    "gmail.compose": [
        "https://www.googleapis.com/auth/gmail.compose",
    ],
    "gmail.send": [
        "https://www.googleapis.com/auth/gmail.send",
    ],
    "calendar.events": [
        "https://www.googleapis.com/auth/calendar.events",
    ],
}


def _flatten_scopes(product_keys: list[str]) -> list[str]:
    """Return a flat list of scope URIs for the given product keys."""
    scopes: list[str] = []
    for key in product_keys:
        scopes.extend(GOOGLE_WORKSPACE_SCOPES_BY_PRODUCT.get(key, []))
    return scopes


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class GoogleOAuthRequiredError(Exception):
    """Raised when the user has no Google OAuth refresh token."""

    def __init__(self, uid: str, message: str | None = None) -> None:
        self.uid = uid
        super().__init__(
            message
            or f"Google OAuth not connected for user {uid}. "
            "Connect Google Workspace before using this feature."
        )


class GoogleOAuthInvalidError(Exception):
    """Raised when the stored refresh token cannot be refreshed."""

    def __init__(self, uid: str, message: str | None = None) -> None:
        self.uid = uid
        super().__init__(
            message
            or f"Google OAuth token for user {uid} is invalid or expired. "
            "Please reconnect Google Workspace."
        )


# ---------------------------------------------------------------------------
# User record helpers
# ---------------------------------------------------------------------------


def get_user_google_record(uid: str) -> dict[str, Any]:
    """Return Google OAuth fields from ``users/{uid}`` Firestore document.

    Returns a dict with keys: ``google_refresh_token``, ``google_scopes``,
    ``google_token_status``, ``google_email``, ``google_connected_at``.
    Missing fields default to ``None`` or empty values.
    """
    db = get_firestore()
    snap = db.collection(USERS_COLLECTION).document(uid).get()
    if not snap.exists:
        return {
            "google_refresh_token": None,
            "google_scopes": [],
            "google_token_status": None,
            "google_email": None,
            "google_connected_at": None,
        }
    data = snap.to_dict() or {}
    return {
        "google_refresh_token": data.get("google_refresh_token"),
        "google_scopes": data.get("google_scopes") or [],
        "google_token_status": data.get("google_token_status"),
        "google_email": data.get("google_email"),
        "google_connected_at": data.get("google_connected_at"),
    }


# ---------------------------------------------------------------------------
# Credential builder
# ---------------------------------------------------------------------------


def build_user_credentials(
    uid: str,
    required_scopes: list[str] | None = None,
) -> Credentials:
    """Build and refresh Google OAuth2 credentials for *uid*.

    Parameters
    ----------
    uid:
        Firebase UID of the user.
    required_scopes:
        Product-scope keys (e.g. ``["documents", "drive.file"]``).  If
        provided, the corresponding full scope URIs will be set on the
        credential object.

    Returns
    -------
    google.oauth2.credentials.Credentials
        A **refreshed** credential ready for API calls.

    Raises
    ------
    GoogleOAuthRequiredError
        If the user has no stored refresh token.
    GoogleOAuthInvalidError
        If the token refresh fails (e.g. user revoked access).
    """
    record = get_user_google_record(uid)
    refresh_token = record.get("google_refresh_token")
    if not refresh_token:
        raise GoogleOAuthRequiredError(uid)

    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        raise RuntimeError(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured "
            "in the backend environment."
        )

    scopes = _flatten_scopes(required_scopes) if required_scopes else None

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=scopes,
    )

    try:
        creds.refresh(GoogleAuthRequest())
    except Exception as exc:
        logger.warning(
            "Google OAuth refresh failed for uid=%s: %s", uid, exc
        )
        # Mark token as invalid in Firestore
        try:
            db = get_firestore()
            db.collection(USERS_COLLECTION).document(uid).update(
                {"google_token_status": "invalid"}
            )
        except Exception as update_exc:
            logger.error(
                "Failed to mark token invalid for uid=%s: %s",
                uid,
                update_exc,
            )
        raise GoogleOAuthInvalidError(uid) from exc

    return creds


# ---------------------------------------------------------------------------
# Validation helper
# ---------------------------------------------------------------------------


def assert_google_oauth_valid(
    uid: str,
    required_scopes: list[str] | None = None,
) -> bool:
    """Verify the user's Google OAuth is connected and refreshable.

    Returns ``True`` on success.  Raises ``GoogleOAuthRequiredError`` or
    ``GoogleOAuthInvalidError`` on failure.
    """
    build_user_credentials(uid, required_scopes)
    return True
