import base64
import hashlib
import logging
import os
import secrets
from urllib.parse import urlencode

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from firebase_admin import auth as firebase_auth_module
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from google_auth_oauthlib.flow import Flow
from google.cloud.firestore import SERVER_TIMESTAMP

from utils.firebase_auth import CurrentUser, get_current_user, init_firebase
from utils.firestore_client import get_firestore
from utils.google_credentials import get_google_flow, GOOGLE_SCOPES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth")

USERS_COLLECTION = "users"
OAUTH_STATES_COLLECTION = "oauth_states"


def _frontend_base_url() -> str:
    return (os.getenv("FRONTEND_URL") or "http://localhost:5173").rstrip("/")


def _google_connect_url() -> str:
    return "/auth/google-scopes"


def _build_flow() -> Flow:
    """Build a Google OAuth Flow (client config, redirect URI, scopes)."""
    return get_google_flow()


@router.post("/init-user")
async def init_user(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    """
    Ensure a Firestore user profile exists (email, display name).
    Called by the frontend after Google sign-in.
    """
    uid = current_user["uid"]
    db = get_firestore()
    user_ref = db.collection(USERS_COLLECTION).document(uid)
    snapshot = user_ref.get()

    if snapshot.exists:
        return {"status": "exists", "uid": uid}

    email = current_user.get("email") or ""
    display_name = current_user.get("name") or current_user.get("display_name")

    user_ref.set(
        {
            "uid": uid,
            "email": email,
            "display_name": display_name,
            "createdAt": SERVER_TIMESTAMP,
        }
    )
    return {"status": "created", "uid": uid}


@router.get("/google-scopes")
async def google_scopes() -> RedirectResponse:
    """
    Start Google OAuth for sign-in and Workspace scopes (Gmail, Calendar, Forms).
    """
    try:
        flow = _build_flow()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    code_verifier = secrets.token_urlsafe(96)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()

    authorization_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
        code_challenge=code_challenge,
        code_challenge_method="S256",
    )

    db = get_firestore()
    db.collection(OAUTH_STATES_COLLECTION).document(state).set(
        {
            "createdAt": SERVER_TIMESTAMP,
            "code_verifier": code_verifier,
        }
    )

    return RedirectResponse(url=authorization_url, status_code=status.HTTP_302_FOUND)


@router.get("/google-scopes/callback")
async def google_scopes_callback(
    state: str | None = Query(None),
    code: str | None = Query(None),
    error: str | None = Query(None),
) -> RedirectResponse:
    frontend = _frontend_base_url()
    failure_url = f"{frontend}/login"

    if error or not state or not code:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    db = get_firestore()
    state_ref = db.collection(OAUTH_STATES_COLLECTION).document(state)
    state_snap = state_ref.get()

    if not state_snap.exists:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    state_data = state_snap.to_dict() or {}
    code_verifier = state_data.get("code_verifier")
    if not code_verifier:
        state_ref.delete()
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    try:
        flow = _build_flow()
        flow.fetch_token(code=code, code_verifier=code_verifier)
        credentials = flow.credentials
        refresh_token = credentials.refresh_token
        google_id = credentials.id_token
    except Exception as exc:
        logger.exception("OAuth callback error: %s", exc)
        state_ref.delete()
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    state_ref.delete()

    if not refresh_token or not google_id:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    if not client_id:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    try:
        init_firebase()
        idinfo = google_id_token.verify_oauth2_token(
            google_id,
            google_requests.Request(),
            client_id,
        )
        email = idinfo.get("email")
        name = idinfo.get("name") or ""
        picture = idinfo.get("picture") or ""
        if not email:
            return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

        try:
            user_record = firebase_auth_module.get_user_by_email(email)
            uid = user_record.uid
            firebase_auth_module.update_user(
                uid,
                display_name=name or None,
                photo_url=picture or None,
            )
        except firebase_auth_module.UserNotFoundError:
            user_record = firebase_auth_module.create_user(
                email=email,
                display_name=name or None,
                photo_url=picture or None,
            )
            uid = user_record.uid

        user_ref = db.collection(USERS_COLLECTION).document(uid)
        user_snap = user_ref.get()
        user_payload: dict = {
            "uid": uid,
            "email": email,
            "display_name": name,
            "google_refresh_token": refresh_token,
            "google_scopes": GOOGLE_SCOPES,
            "google_token_status": "valid",
            "google_oauth_provider": "google",
            "google_email": email,
        }
        if picture:
            user_payload["photo_url"] = picture
        if not user_snap.exists:
            user_payload["createdAt"] = SERVER_TIMESTAMP
        user_ref.set(user_payload, merge=True)

        custom_token = firebase_auth_module.create_custom_token(uid).decode("utf-8")
    except Exception as exc:
        logger.exception("OAuth callback error: %s", exc)
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    success_url = f"{frontend}/auth/callback?{urlencode({'custom_token': custom_token})}"
    return RedirectResponse(url=success_url, status_code=status.HTTP_302_FOUND)


@router.get("/google/status")
async def google_status(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    uid = current_user["uid"]
    
    from services.google_workspace.credentials import get_user_google_record, assert_google_oauth_valid, GoogleOAuthInvalidError, GoogleOAuthRequiredError
    
    record = get_user_google_record(uid)
    has_token = bool(record.get("google_refresh_token"))
    
    if not has_token:
        return {
            "connected": False,
            "valid": False,
            "has_google_scopes": False,
            "scopes": [],
            "missing_scopes": GOOGLE_SCOPES,
            "message": "Not connected",
            "connect_url": _google_connect_url(),
        }
        
    try:
        assert_google_oauth_valid(uid)
        is_valid = True
        message = "Connected and valid"
    except (GoogleOAuthRequiredError, GoogleOAuthInvalidError):
        is_valid = False
        message = "Token invalid or expired"
        
    current_scopes = record.get("google_scopes") or []
    missing_scopes = [s for s in GOOGLE_SCOPES if s not in current_scopes]
    
    return {
        "connected": True,
        "valid": is_valid,
        "has_google_scopes": len(missing_scopes) == 0 and is_valid,
        "scopes": current_scopes,
        "missing_scopes": missing_scopes,
        "message": message,
        "connect_url": _google_connect_url(),
    }


@router.get("/check-permissions")
async def check_permissions(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, bool]:
    uid = current_user["uid"]
    db = get_firestore()
    snapshot = db.collection(USERS_COLLECTION).document(uid).get()

    if not snapshot.exists:
        return {"has_google_scopes": False}

    data = snapshot.to_dict() or {}
    token = data.get("google_refresh_token")
    return {"has_google_scopes": bool(token)}
