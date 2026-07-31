"""Draft class emails with Vertex Gemini (subject + body JSON)."""

from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)


class EmailAiError(Exception):
    """Raised when email draft generation fails or is not configured."""


def generate_email_draft(
    *,
    prompt: str,
    batch_name: str = "",
    course_name: str = "",
    sender_name: str = "",
) -> dict[str, str]:
    """Return ``{"subject": "...", "body": "..."}`` from a lecturer prompt."""
    text = (prompt or "").strip()
    if not text:
        raise EmailAiError("Prompt is required.")

    # Prefer a regional Vertex endpoint — `global` 404s for many Gemini flash IDs.
    model = (
        (os.getenv("EMAIL_DRAFT_MODEL") or "").strip()
        or (os.getenv("ATTACHMENT_VISION_MODEL") or "").strip()
        or "gemini-2.5-flash"
    )
    location = (
        (os.getenv("EMAIL_DRAFT_LOCATION") or "").strip()
        or (os.getenv("GOOGLE_CLOUD_LOCATION") or "").strip()
        or (os.getenv("AGENT_ENGINE_LOCATION") or "").strip()
        or "us-central1"
    )
    project = (os.getenv("GOOGLE_CLOUD_PROJECT") or "").strip()
    if not project:
        raise EmailAiError("Email AI is not configured (GOOGLE_CLOUD_PROJECT).")

    sender = sender_name.strip()

    context_bits = []
    if batch_name.strip():
        context_bits.append(f"Batch: {batch_name.strip()}")
    if course_name.strip():
        context_bits.append(f"Course: {course_name.strip()}")
    if sender:
        context_bits.append(f"Sender (sign the email with this name): {sender}")
    context = "\n".join(context_bits)

    signature_rule = (
        f"End the body with a sign-off followed by exactly '{sender}'."
        if sender
        else "End the body with a sign-off and no name."
    )
    system = (
        "You draft professional emails from a university lecturer to students. "
        "Return strict JSON with string fields subject and body only. "
        "Keep the subject short. Write a clear, polite plain-text body. "
        "Do not invent recipient names or grade details the lecturer did not provide. "
        "Never emit placeholders such as [Your Name], [Lecturer's Name], or [Course]. "
        + signature_rule
    )
    user = f"{context}\n\nLecturer request:\n{text}" if context else f"Lecturer request:\n{text}"

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(
            vertexai=True,
            project=project,
            location=location,
        )
        response = client.models.generate_content(
            model=model,
            contents=[system, user],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        parsed = json.loads(response.text or "{}")
    except EmailAiError:
        raise
    except Exception as exc:
        logger.warning(
            "email AI draft failed model=%s location=%s: %s", model, location, exc
        )
        raise EmailAiError(f"Failed to draft email: {exc}") from exc

    subject = str(parsed.get("subject") or "").strip()
    body = str(parsed.get("body") or "").strip()
    if not subject or not body:
        raise EmailAiError("AI returned an incomplete email draft.")
    return {"subject": subject[:200], "body": body}
