"""Wellness router — stress meter state, breathing exercise, reflection journal."""

import logging

from fastapi import APIRouter, Depends

from entity.Wellness import (
    BreathingResult,
    JournalCreate,
    JournalEntryModel,
    StressIncreaseRequest,
    StressState,
)
from services.wellness_service import (
    MAX_CLIENT_INCREASE,
    complete_breathing,
    get_stress_state,
    increase_stress,
    list_journal,
    save_journal,
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
    return StressState(**increase_stress(current_user["uid"], amount))


@router.post("/breathing", response_model=BreathingResult)
async def complete_breathing_endpoint(
    current_user: CurrentUser = Depends(get_current_user),
) -> BreathingResult:
    return BreathingResult(**complete_breathing(current_user["uid"]))


@router.get("/journal", response_model=list[JournalEntryModel])
async def list_journal_endpoint(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[JournalEntryModel]:
    return [JournalEntryModel(**row) for row in list_journal(current_user["uid"])]


@router.post("/journal", response_model=dict)
async def save_journal_endpoint(
    body: JournalCreate,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    mood = body.mood.strip()
    if not mood:
        return {"ok": False, "reason": "mood_required"}
    return save_journal(current_user["uid"], mood, body.notes.strip())
