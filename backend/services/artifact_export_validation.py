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
