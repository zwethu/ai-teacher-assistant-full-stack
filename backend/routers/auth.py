import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from google.cloud.firestore import SERVER_TIMESTAMP

from utils.deps import get_current_user_bearer_or_query
from utils.firebase_auth import CurrentUser, get_current_user
from utils.firestore_client import get_firestore
from utils.google_credentials import get_google_flow

router = APIRouter()

USERS_COLLECTION = "users"
OAUTH_STATES_COLLECTION = "oauth_states"
OAUTH_STATE_TTL_MINUTES = 10


def _frontend_base_url() -> str:
    return (os.getenv("FRONTEND_URL") or "http://localhost:5173").rstrip("/")


@router.get("/google-scopes")
async def google_scopes(
    current_user: CurrentUser = Depends(get_current_user_bearer_or_query),
) -> RedirectResponse:
    """
    Start Google Workspace OAuth.
    Browser: open with ?firebase_token=<Firebase ID token>.
    API clients may use Authorization: Bearer instead.
    """
    try:
        flow = get_google_flow()
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
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OAUTH_STATE_TTL_MINUTES)
    db.collection(OAUTH_STATES_COLLECTION).document(state).set(
        {
            "uid": current_user["uid"],
            "created_at": SERVER_TIMESTAMP,
            "expires_at": expires_at,
        }
    )

    return RedirectResponse(url=authorization_url, status_code=status.HTTP_302_FOUND)


@router.get("/google-scopes/callback")
async def google_scopes_callback(request: Request) -> RedirectResponse:
    frontend = _frontend_base_url()
    error_redirect = f"{frontend}?google_scopes=error"

    url_state = request.query_params.get("state")
    if not url_state:
        return RedirectResponse(
            url=f"{error_redirect}&message=missing_state",
            status_code=status.HTTP_302_FOUND,
        )

    db = get_firestore()
    state_ref = db.collection(OAUTH_STATES_COLLECTION).document(url_state)
    state_snap = state_ref.get()

    if not state_snap.exists:
        return RedirectResponse(
            url=f"{error_redirect}&message=invalid_state",
            status_code=status.HTTP_302_FOUND,
        )

    state_data = state_snap.to_dict() or {}
    expires_at = state_data.get("expires_at")
    if expires_at:
        if getattr(expires_at, "tzinfo", None) is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            state_ref.delete()
            return RedirectResponse(
                url=f"{error_redirect}&message=state_expired",
                status_code=status.HTTP_302_FOUND,
            )

    uid = state_data.get("uid")
    if not uid:
        state_ref.delete()
        return RedirectResponse(
            url=f"{error_redirect}&message=invalid_state",
            status_code=status.HTTP_302_FOUND,
        )

    if request.query_params.get("error"):
        state_ref.delete()
        return RedirectResponse(
            url=f"{error_redirect}&message=access_denied",
            status_code=status.HTTP_302_FOUND,
        )

    code = request.query_params.get("code")
    if not code:
        state_ref.delete()
        return RedirectResponse(
            url=f"{error_redirect}&message=missing_code",
            status_code=status.HTTP_302_FOUND,
        )

    try:
        flow = get_google_flow()
        flow.fetch_token(authorization_response=str(request.url))
        credentials = flow.credentials
    except Exception:
        state_ref.delete()
        return RedirectResponse(
            url=f"{error_redirect}&message=token_exchange_failed",
            status_code=status.HTTP_302_FOUND,
        )

    state_ref.delete()

    refresh_token = credentials.refresh_token
    if not refresh_token:
        return RedirectResponse(
            url=f"{error_redirect}&message=no_refresh_token",
            status_code=status.HTTP_302_FOUND,
        )

    user_ref = db.collection(USERS_COLLECTION).document(uid)
    if not user_ref.get().exists:
        return RedirectResponse(
            url=f"{error_redirect}&message=user_not_found",
            status_code=status.HTTP_302_FOUND,
        )

    user_ref.update(
        {
            "google_refresh_token": refresh_token,
            "google_scopes": list(credentials.scopes or []),
            "google_connected_at": SERVER_TIMESTAMP,
        }
    )

    return RedirectResponse(
        url=f"{frontend}?google_scopes=success",
        status_code=status.HTTP_302_FOUND,
    )


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
    return {"has_google_scopes": bool(data.get("google_refresh_token"))}
