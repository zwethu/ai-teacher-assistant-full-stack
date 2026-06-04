from typing import Annotated, Any

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from utils.firebase_auth import CurrentUser, get_current_user, verify_id_token

_bearer = HTTPBearer(auto_error=False)

# Backward-compatible alias
FirebaseUser = dict[str, Any]


async def get_current_user_bearer_or_query(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    firebase_token: Annotated[
        str | None,
        Query(description="Firebase ID token for browser redirects"),
    ] = None,
) -> CurrentUser:
    """Bearer header (API calls) or ?firebase_token= (browser navigation to OAuth start)."""
    if credentials and credentials.scheme.lower() == "bearer":
        return verify_id_token(credentials.credentials)
    if firebase_token:
        return verify_id_token(firebase_token)
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing Firebase ID token",
    )
