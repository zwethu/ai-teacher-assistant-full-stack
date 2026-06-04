import os
from typing import Annotated, Any, TypedDict

import firebase_admin
from firebase_admin import auth as firebase_auth_module
from firebase_admin import credentials
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_app: firebase_admin.App | None = None
_bearer = HTTPBearer(auto_error=False)


class CurrentUser(TypedDict):
    uid: str
    email: str | None
    name: str | None
    picture: str | None


def init_firebase() -> firebase_admin.App:
    """
    Initialize Firebase Admin once.

    Credentials:
    - Local: GOOGLE_APPLICATION_CREDENTIALS pointing to a service account JSON
    - Cloud Run: Application Default Credentials
    """
    global _app
    if _app is not None:
        return _app

    project_id = (os.getenv("FIREBASE_PROJECT_ID") or "").strip()
    if not project_id:
        raise RuntimeError("FIREBASE_PROJECT_ID must be set")

    cred_path = (os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    if cred_path and os.path.isfile(cred_path):
        cred = credentials.Certificate(cred_path)
    else:
        cred = credentials.ApplicationDefault()

    _app = firebase_admin.initialize_app(cred, {"projectId": project_id})
    return _app


def _claims_to_user(decoded: dict[str, Any]) -> CurrentUser:
    return {
        "uid": decoded["uid"],
        "email": decoded.get("email"),
        "name": decoded.get("name"),
        "picture": decoded.get("picture"),
    }


def verify_id_token(id_token: str) -> CurrentUser:
    """Verify a Firebase ID token and return a normalized user dict."""
    init_firebase()
    try:
        decoded = firebase_auth_module.verify_id_token(id_token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc
    return _claims_to_user(decoded)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(_bearer),
    ],
) -> CurrentUser:
    """
    FastAPI dependency: read Authorization Bearer token and verify with Firebase Admin.
    """
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Firebase ID token",
        )
    return verify_id_token(credentials.credentials)
