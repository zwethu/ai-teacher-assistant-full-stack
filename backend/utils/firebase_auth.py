import os
from typing import Annotated, Any

import firebase_admin
from firebase_admin import auth as firebase_auth_module
from firebase_admin import credentials
from fastapi import HTTPException, Query, Request, status

_app: firebase_admin.App | None = None

CurrentUser = dict[str, Any]


def init_firebase() -> firebase_admin.App:
    """Initialize Firebase Admin once using the service account key file."""
    global _app
    if _app is not None:
        return _app

    cred_path = (os.getenv("FIREBASE_SERVICE_ACCOUNT") or "").strip()
    if cred_path and not os.path.isabs(cred_path):
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        cred_path = os.path.join(backend_dir, cred_path)
    if not cred_path or not os.path.isfile(cred_path):
        raise RuntimeError(
            "FIREBASE_SERVICE_ACCOUNT must point to a valid service account JSON file"
        )

    cred = credentials.Certificate(cred_path)
    options: dict[str, str] = {}
    project_id = (os.getenv("FIREBASE_PROJECT_ID") or "").strip()
    if project_id:
        options["projectId"] = project_id

    _app = firebase_admin.initialize_app(cred, options or None)
    return _app


def verify_id_token(id_token: str) -> dict[str, Any]:
    """Verify a Firebase ID token and return the decoded claims dict."""
    try:
        init_firebase()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    try:
        return firebase_auth_module.verify_id_token(id_token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


async def get_current_user(
    request: Request,
    firebase_token: Annotated[
        str | None,
        Query(description="Firebase ID token for browser OAuth redirects"),
    ] = None,
) -> dict[str, Any]:
    """
    FastAPI dependency: verify Firebase ID token from Bearer header or ?firebase_token=.
    """
    auth_header = request.headers.get("Authorization")
    if auth_header:
        parts = auth_header.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1].strip()
            if token:
                return verify_id_token(token)

    token = firebase_token or request.query_params.get("firebase_token")
    if token:
        return verify_id_token(token)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing Firebase ID token",
    )
