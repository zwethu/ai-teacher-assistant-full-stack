from typing import Annotated, Any

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from services.lecturer_service import LECTURER_ROLE
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


async def require_lecturer(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CurrentUser:
    """Reject anyone without the lecturer claim.

    A valid Firebase token is NOT authorization here. Students sign into the
    same project to play their game, so "the token verifies" only proves the
    caller is a person — this dependency is what proves they are staff.

    Applied once per router in main.py rather than per endpoint: the student
    game talks to Firestore directly and never calls this API, so every route
    outside `auth` (which has to work before you have a role) and `tasks`
    (machine-to-machine, OIDC) is lecturer-only by definition. Guarding at the
    include keeps a newly added endpoint protected by default instead of
    protected only if someone remembers.
    """
    if current_user.get("role") != LECTURER_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This area is for lecturers.",
        )
    return current_user
