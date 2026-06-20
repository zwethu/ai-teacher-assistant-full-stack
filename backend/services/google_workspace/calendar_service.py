"""Calendar API service — creates calendar events for users.

Placeholder for future PNAI functionality.
"""

from __future__ import annotations

import logging
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from services.google_workspace.credentials import build_user_credentials

logger = logging.getLogger(__name__)


def _build_calendar_service(uid: str):
    creds = build_user_credentials(uid, ["calendar.events"])
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def create_calendar_event_for_user(
    uid: str,
    event_payload: dict[str, Any],
) -> dict[str, Any]:
    """Create a Calendar event in the user's primary calendar."""
    service = _build_calendar_service(uid)
    
    # We pass the raw payload through to the Calendar API for now, 
    # assuming it matches the Calendar API event structure.
    try:
        event = service.events().insert(
            calendarId='primary',
            body=event_payload,
        ).execute()
        return {"event_id": event.get("id"), "event_url": event.get("htmlLink")}
    except HttpError as exc:
        logger.error("Failed to create calendar event for uid=%s: %s", uid, exc)
        raise RuntimeError(f"Failed to create calendar event: {exc}") from exc
