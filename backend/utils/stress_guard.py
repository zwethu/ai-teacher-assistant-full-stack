"""Dependency that blocks a feature endpoint while the user's stress is at 100.

Usage — add alongside the normal user dependency:

    @router.post("/invoke")
    async def invoke_agent(
        user: CurrentUser = Depends(get_current_user),
        _stress: None = Depends(stress_guard),
    ): ...

The 403 detail is a dict with `blocked: true` so the frontend interceptor can
tell a stress block apart from a role/permission 403.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status

from services.wellness_service import get_stress_state
from utils.firebase_auth import CurrentUser, get_current_user

BLOCKED_MESSAGE = (
    "Your stress level is at maximum. Do a breathing exercise or take a "
    "break — stress eases over time when you step away."
)


async def stress_guard(
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> None:
    state = get_stress_state(current_user["uid"])
    if state["blocked"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "blocked": True,
                "stress_score": state["stress_score"],
                "message": BLOCKED_MESSAGE,
            },
        )
