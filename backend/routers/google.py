from fastapi import APIRouter, Depends

from utils.firebase_auth import CurrentUser, get_current_user

router = APIRouter()

# Google Workspace proxy — implementation pending
# React should NOT hold refresh tokens for Gmail/Calendar/Forms.
# Protected routes use Firebase ID token; server uses stored Google refresh token.


@router.get("/status")
async def google_connection_status(
    _user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    """Placeholder — whether user has linked Google Workspace."""
    return {"status": "not_implemented"}
