import os
from pathlib import Path
from typing import Annotated, Any

import firebase_admin
from firebase_admin import auth as firebase_auth_module
from firebase_admin import credentials
from fastapi import HTTPException, Query, Request, status

_app: firebase_admin.App | None = None

CurrentUser = dict[str, Any]


def init_firebase() -> firebase_admin.App:
    """Initialize Firebase Admin once, preferring a key file and falling back to ADC.

    Firebase now lives in the same GCP project as everything else, so no key is
    required: locally ADC comes from `gcloud auth application-default login`, and on
    Cloud Run it is the attached runtime service account. A key file is still honoured
    when present, which keeps pointing at a different Firebase project possible.
    """
    global _app
    if _app is not None:
        return _app

    backend_dir = Path(__file__).resolve().parents[1]
    cred_path = (os.getenv("FIREBASE_SERVICE_ACCOUNT") or "").strip()
    resolved = Path(cred_path) if cred_path else backend_dir / "serviceAccountKey.json"
    if not resolved.is_absolute():
        resolved = backend_dir / resolved
    if not resolved.is_file():
        fallback = backend_dir / "serviceAccountKey.json"
        if fallback.is_file():
            resolved = fallback

    options: dict[str, str] = {}
    project_id = (os.getenv("FIREBASE_PROJECT_ID") or "").strip()
    if project_id:
        options["projectId"] = project_id

    if resolved.is_file():
        os.environ["FIREBASE_SERVICE_ACCOUNT"] = str(resolved)
        cred = credentials.Certificate(str(resolved))
    else:
        # No key on disk — this is the expected path in production.
        # ApplicationDefault() raises a clear DefaultCredentialsError if ADC is absent
        # too, so a genuinely unauthenticated environment still fails loudly.
        cred = credentials.ApplicationDefault()
        # create_custom_token() has to SIGN a JWT, which ADC alone cannot do: a user
        # credential has no private key, and off-GCP there is no metadata server to
        # discover a service account from. Naming one here makes firebase_admin sign
        # through the IAM SignBlob API instead. The caller needs
        # roles/iam.serviceAccountTokenCreator on that account — on Cloud Run the
        # runtime SA signs as itself; locally your ADC user needs the same role.
        signer = (os.getenv("FIREBASE_SERVICE_ACCOUNT_ID") or "").strip()
        if signer:
            options["serviceAccountId"] = signer

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
