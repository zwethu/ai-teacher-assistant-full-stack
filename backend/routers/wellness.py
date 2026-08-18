"""Wellness router — stress meter state, breathing exercise, activity journal.

Nothing here gates a feature. The meter reports; it does not refuse.
"""

import logging

from fastapi import APIRouter, Depends

from entity.Wellness import (
    BreathingResult,
    JournalPage,
    StressIncreaseRequest,
    StressState,
)
from services.wellness_service import (
    MAX_CLIENT_INCREASE,
    complete_breathing,
    get_stress_state,
    increase_stress,
    list_journal,
)
from utils.firebase_auth import CurrentUser, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wellness", tags=["wellness"])


@router.get("/stress", response_model=StressState)
async def get_stress_endpoint(
    current_user: CurrentUser = Depends(get_current_user),
) -> StressState:
    return StressState(**get_stress_state(current_user["uid"]))


@router.post("/stress/increase", response_model=StressState)
async def increase_stress_endpoint(
    body: StressIncreaseRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> StressState:
    """Client-reported bump (rapid clicking). Amount is clamped server-side —
    real feature costs are charged by the feature endpoints, not this route."""
    amount = min(max(body.amount, 0.0), MAX_CLIENT_INCREASE)
    return StressState(
        **increase_stress(current_user["uid"], amount, action="rapid_click")
    )


@router.post("/breathing", response_model=BreathingResult)
async def complete_breathing_endpoint(
    current_user: CurrentUser = Depends(get_current_user),
) -> BreathingResult:
    return BreathingResult(**complete_breathing(current_user["uid"]))


@router.get("/journal", response_model=JournalPage)
async def list_journal_endpoint(
    month: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
) -> JournalPage:
    """One month of daily reports (`month` as YYYY-MM, default this month).

    Reading is what finalises finished days, so this is the only place a report
    gets written.
    """
    return JournalPage(**list_journal(current_user["uid"], month))
