"""Game endpoints — the lecturer-confirmed terminal for the game.generate workflow.

POST /batches/{batch_id}/games/from-run is the "Create game" button's target: it reads
the game the agent staged on that run's pending artifact and writes the gameSessions doc.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from entity.GameSession import CreateGameRequest, UpdateGameRequest
from services.game_service import (
    GameConflictError,
    GameEligibilityError,
    GameNotFoundError,
    create_game_from_pending,
    delete_game,
    get_game,
    list_games,
    update_game,
)
from utils.firebase_auth import CurrentUser, get_current_user

router = APIRouter(prefix="/batches/{batch_id}/games", tags=["games"])


def _raise_service_error(exc: Exception) -> None:
    if isinstance(exc, GameNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, GameConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, GameEligibilityError):
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    raise exc


@router.post("/from-run", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_from_run(
    batch_id: str,
    body: CreateGameRequest,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    try:
        return create_game_from_pending(batch_id, user["uid"], body)
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.get("", response_model=list[dict])
async def list_batch_games(
    batch_id: str, user: CurrentUser = Depends(get_current_user)
) -> list[dict]:
    try:
        return list_games(batch_id, user["uid"])
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.get("/{game_id}", response_model=dict)
async def get_batch_game(
    batch_id: str, game_id: str, user: CurrentUser = Depends(get_current_user)
) -> dict:
    del batch_id
    try:
        return get_game(game_id, user["uid"])
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.patch("/{game_id}", response_model=dict)
async def update_batch_game(
    batch_id: str,
    game_id: str,
    body: UpdateGameRequest,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    del batch_id
    try:
        return update_game(game_id, user["uid"], body)
    except Exception as exc:
        _raise_service_error(exc)
        raise


@router.delete("/{game_id}", response_model=dict)
async def delete_batch_game(
    batch_id: str, game_id: str, user: CurrentUser = Depends(get_current_user)
) -> dict:
    del batch_id
    try:
        return delete_game(game_id, user["uid"])
    except Exception as exc:
        _raise_service_error(exc)
        raise
