import os

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from google_auth_oauthlib.flow import Flow
from google.cloud.firestore import SERVER_TIMESTAMP

from utils.firebase_auth import CurrentUser, get_current_user
from utils.firestore_client import get_firestore
from utils.google_credentials import get_google_flow

router = APIRouter(prefix="/auth")

USERS_COLLECTION = "users"
OAUTH_STATES_COLLECTION = "oauth_states"


def _frontend_base_url() -> str:
    return (os.getenv("FRONTEND_URL") or "http://localhost:5173").rstrip("/")


def _build_flow() -> Flow:
    """Build a Google OAuth Flow (client config, redirect URI, scopes)."""
    return get_google_flow()


@router.get("/google-scopes")
async def google_scopes(
    current_user: CurrentUser = Depends(get_current_user),
) -> RedirectResponse:
    """
    Start Google Workspace OAuth.
    Requires Authorization: Bearer <Firebase ID token>.
    """
    try:
        flow = _build_flow()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc

    authorization_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
    )

    db = get_firestore()
    db.collection(OAUTH_STATES_COLLECTION).document(state).set(
        {
            "uid": current_user["uid"],
            "createdAt": SERVER_TIMESTAMP,
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
    success_url = f"{frontend}/email?connected=true"
    failure_url = f"{frontend}/email?connected=false"

    if error or not state or not code:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    db = get_firestore()
    state_ref = db.collection(OAUTH_STATES_COLLECTION).document(state)
    state_snap = state_ref.get()

    if not state_snap.exists:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    state_data = state_snap.to_dict() or {}
    uid = state_data.get("uid")
    if not uid:
        state_ref.delete()
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    try:
        flow = _build_flow()
        flow.fetch_token(code=code)
        refresh_token = flow.credentials.refresh_token
    except Exception:
        state_ref.delete()
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    state_ref.delete()

    if not refresh_token:
        return RedirectResponse(url=failure_url, status_code=status.HTTP_302_FOUND)

    db.collection(USERS_COLLECTION).document(uid).set(
        {"google_refresh_token": refresh_token},
        merge=True,
    )

    return RedirectResponse(url=success_url, status_code=status.HTTP_302_FOUND)


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
