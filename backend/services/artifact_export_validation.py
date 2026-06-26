"""Coverage checks before generated artifacts are exported."""

from __future__ import annotations

import json
from typing import Any


class ArtifactExportCoverageError(RuntimeError):
    """Raised when content_json is missing sections required for export."""


def validate_export_coverage(artifact_type: str, payload: dict[str, Any]) -> None:
    if artifact_type == "lab":
        _validate_lab(payload)
    elif artifact_type == "lesson_plan":
        _validate_lesson_plan(payload)


def validate_rendered_blocks_coverage(
    artifact_type: str,
    payload: dict[str, Any],
    blocks: list[Any],
    mode: str | None = None,
) -> None:
    """Verify builder blocks contain required sections and rich payload values."""
    text = _blocks_text(blocks)
    missing: list[str] = []
    if artifact_type == "lesson_plan":
        _require_terms(
            text,
            missing,
            (
                "learning objectives",
                "lesson timeline",
                "lesson activities",
                "assessment",
                "homework",
            ),
        )
        for activity in payload.get("activities") or []:
            for heading, key in (
                ("teacher actions", "teacher_actions"),
                ("student actions", "student_actions"),
                ("prompt templates", "prompt_templates"),
                ("code / configuration blocks", "code_blocks"),
                ("assessment checks", "assessment_checks"),
            ):
                if activity.get(key):
                    _require_terms(text, missing, (heading,))
                    _require_rich_values(text, missing, key, activity.get(key))
        _raise_if_missing("Lesson plan rendered block coverage failed", missing)
        return

    if artifact_type != "lab":
        return

    if mode == "lecturer":
        _require_terms(
            text,
            missing,
            (
                str(payload.get("title") or "").lower(),
                "learning objectives",
                "environment setup",
                "instructor walkthrough",
                "checkpoints",
                "rubric",
            ),
        )
        has_troubleshooting = bool(payload.get("troubleshooting")) or any(
            step.get("common_errors") for step in payload.get("procedure_steps") or []
        )
        if has_troubleshooting:
            _require_terms(text, missing, ("troubleshooting",))
    elif mode == "student":
        _require_terms(
            text,
            missing,
            (
                str(payload.get("title") or "").lower(),
                "what you will learn",
                "before you start",
                "step-by-step procedure",
                "what to submit",
                "rubric",
            ),
        )
        if payload.get("submission_checklist"):
            _require_terms(text, missing, ("submission checklist",))
            _require_rich_values(text, missing, "submission_checklist", payload.get("submission_checklist"))

    for step in payload.get("procedure_steps") or []:
        for key in ("prompt_templates", "code_blocks", "config_templates"):
            if step.get(key):
                _require_rich_values(text, missing, key, step.get(key))

    _raise_if_missing(f"Lab rendered block coverage failed mode={mode or 'unknown'}", missing)


def _validate_lab(payload: dict[str, Any]) -> None:
    missing: list[str] = []
    required = {
        "learning objectives": payload.get("learning_objectives"),
        "environment setup": payload.get("environment_profile"),
        "procedure steps": payload.get("procedure_steps"),
        "checkpoints": payload.get("checkpoints"),
        "deliverables": payload.get("deliverables"),
        "rubric": payload.get("rubric"),
    }
    for label, value in required.items():
        if not value:
            missing.append(label)

    text = _payload_text(payload)
    if "firebase" in text or "firestore" in text:
        for marker in ("firebase", "firestore", "firebaseconfig", "onsnapshot"):
            if marker not in text:
                missing.append(marker)
        if "rules_version" not in text and "security rules" not in text:
            missing.append("rules_version or security rules")
    if "bolt" in text and "bolt.new" not in text:
        missing.append("Bolt.new")
    if "lovable" in text and "lovable.dev" not in text:
        missing.append("Lovable.dev")

    if missing:
        raise ArtifactExportCoverageError(
            "Lab export coverage failed; missing: " + ", ".join(sorted(set(missing)))
        )


def _validate_lesson_plan(payload: dict[str, Any]) -> None:
    missing = [
        label
        for label, value in {
            "learning objectives": payload.get("objectives"),
            "lesson timeline": payload.get("detailed_timeline"),
            "lesson activities": payload.get("activities"),
            "assessment": payload.get("assessment"),
            "homework": payload.get("homework"),
        }.items()
        if not value
    ]
    if missing:
        raise ArtifactExportCoverageError(
            "Lesson plan export coverage failed; missing: " + ", ".join(missing)
        )


def _payload_text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False).lower()


def _blocks_text(blocks: list[Any]) -> str:
    parts: list[str] = []
    for block in blocks:
        text = getattr(block, "text", None)
        if text:
            parts.append(str(text))
        headers = getattr(block, "headers", None)
        if headers:
            parts.extend(str(header) for header in headers)
        rows = getattr(block, "rows", None)
        if rows:
            for row in rows:
                parts.extend(str(cell) for cell in row)
    return "\n".join(parts).lower()


def _require_terms(text: str, missing: list[str], terms: tuple[str, ...]) -> None:
    for term in terms:
        clean = str(term or "").strip().lower()
        if clean and clean not in text:
            missing.append(clean)


def _require_rich_values(text: str, missing: list[str], key: str, values: Any) -> None:
    normalized_text = _normalize_text(text)
    for value in values or []:
        candidates = _value_candidates(value)
        if candidates and not any(
            candidate in text or candidate in normalized_text
            for candidate in candidates
        ):
            missing.append(f"{key}: {candidates[0][:80]}")


def _value_candidates(value: Any) -> list[str]:
    if isinstance(value, str):
        return _text_candidates(value)
    if isinstance(value, dict):
        candidates: list[str] = []
        for field in ("title", "code", "content", "text", "name"):
            raw = str(value.get(field) or "").strip()
            candidates.extend(_text_candidates(raw))
        return candidates
    return _text_candidates(str(value))


def _text_candidates(value: str) -> list[str]:
    clean = _normalize_text(value)
    if not clean:
        return []
    candidates = [clean]
    words = clean.split()
    if len(words) > 8:
        candidates.append(" ".join(words[:8]))
    if len(clean) > 120:
        candidates.append(clean[:120])
    return candidates


def _normalize_text(value: str) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _raise_if_missing(prefix: str, missing: list[str]) -> None:
    if missing:
        raise ArtifactExportCoverageError(
            prefix + "; missing: " + ", ".join(sorted(set(missing)))
        )
