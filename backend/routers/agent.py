from fastapi import APIRouter, Depends

from utils.firebase_auth import CurrentUser, get_current_user

router = APIRouter()

# Agent Engine proxy — implementation pending
# Prefer calling Agent Engine from React with the user's Firebase ID token.
# Use this router only if Agent Engine requires a server-side credential or private URL.


@router.post("/invoke")
async def invoke_agent(
    _user: CurrentUser = Depends(get_current_user),
) -> dict[str, str]:
    """Placeholder — forward to GCP Agent Engine when proxy is required."""
    return {"status": "not_implemented"}
