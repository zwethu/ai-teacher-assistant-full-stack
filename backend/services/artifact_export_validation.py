"""Coverage checks before generated artifacts are exported."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Fields that say what a lab *uses*, as opposed to what it merely mentions.
#
# The topic checklists below used to arm on any occurrence anywhere in the
# payload, which meant a Retool + PostgreSQL lab was refused export because one
# sentence read "transitions students from the Week 4 Firestore NoSQL backend to
# relational PostgreSQL" — that single reference demanded the lab also teach
# firebaseConfig, onSnapshot and security rules. A week-by-week course makes
# that kind of backward reference constantly.
#
# A lab that genuinely teaches a tool names it where the work is: the title, the
# environment it needs, the files it ships, what students will be able to do,
# and the steps themselves. A lab that is only looking back at last week names
# it in prose — `prior_week_bridge`, `student_overview`, `lesson_plan_alignment`
# — which is deliberately not consulted here.
_USAGE_FIELDS = (
    "title",
    "topic",
    "environment_profile",
    "materials",
    "starter_files",
    "learning_objectives",
    "lecturer_setup",
    "pre_lab_tasks",
)

_USAGE_STEP_FIELDS = (
    "title",
    "student_instruction",
    "prompt_templates",
    "code_blocks",
    "config_templates",
)

# Ways a lab can legitimately say what governs access to the database. There is
# no canonical phrasing: one lab writes "publish the security rules", the next
# "ensure your Firestore rules allow Service Account access".
_ACCESS_CONTROL_PHRASES = (
    "rules_version",
    "security rules",
    "firestore rules",
    "database rules",
    "firestore.rules",
)

# `firebaseConfig` and `onSnapshot` belong to one way of using Firestore: a
# browser client built on the JS SDK. A lab can be entirely about Firestore and
# never go near either — a Retool admin portal reaches it server-side through a
# service-account key, and its setup notes tell students to download exactly
# that *instead of* the web client config. Requiring firebaseConfig there is
# requiring the thing the lab warns against.
_FIREBASE_CLIENT_SIGNALS = (
    "initializeapp",
    "firebase sdk",
    "firebase-tools",
    "firebase cli",
    "firebase/firestore",
)

# …and `firebase-admin` is the server-side SDK, whose `initializeApp` is not the
# browser one. Checked after the signals above so an Admin-SDK lab is not held
# to a client checklist on the strength of a shared function name.
_FIREBASE_SERVER_SIGNALS = ("firebase-admin", "admin sdk", "service account")


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
    """Block a lab export only for sections that are objectively absent.

    Topic coverage is reported, not enforced — see `lab_topic_gaps`.
    """
    missing = [
        label
        for label, value in {
            "learning objectives": payload.get("learning_objectives"),
            "environment setup": payload.get("environment_profile"),
            "procedure steps": payload.get("procedure_steps"),
            "checkpoints": payload.get("checkpoints"),
            "deliverables": payload.get("deliverables"),
            "rubric": payload.get("rubric"),
        }.items()
        if not value
    ]

    gaps = lab_topic_gaps(payload)
    if gaps:
        logger.warning(
            "Lab topic coverage gaps (advisory, not blocking) title=%r missing=%s",
            payload.get("title"),
            ", ".join(gaps),
        )

    if missing:
        raise ArtifactExportCoverageError(
            "Lab export coverage failed; missing: " + ", ".join(sorted(set(missing)))
        )


def lab_topic_gaps(payload: dict[str, Any]) -> list[str]:
    """Topic-specific coverage a lab *might* be expected to have.

    Advisory only. These are guesses about pedagogy made from keywords, and
    three real labs in a row were refused export by them while being perfectly
    well-formed:

      · a Retool + PostgreSQL lab whose only Firestore reference was a sentence
        about what students did the week before;
      · a Retool + Firestore lab reached through a service-account key, told it
        must contain `firebaseConfig` — the web client config its own setup
        notes tell students *not* to download;
      · an n8n + `firebase-admin` lab, told it must contain `onSnapshot`, a
        browser-SDK listener with nowhere to run, and told it never mentioned
        security rules when its pre-lab tasks say "ensure your Firestore rules
        allow Service Account access".

    Each was patchable with another keyword, and the next lab found the next
    gap. A keyword cannot tell "uses Firebase" from "mentions Firebase", nor
    "client SDK" from "Admin SDK", nor rank the many correct ways to write the
    same sentence. What it can do is point at something worth a second look,
    which is what this is now for. The blocking check above stays: a lab with no
    rubric is missing a rubric, and that is not a guess.
    """
    gaps: list[str] = []
    uses = _usage_text(payload)
    text = _payload_text(payload)

    if "firebase" in uses or "firestore" in uses:
        if not any(phrase in text for phrase in _ACCESS_CONTROL_PHRASES):
            gaps.append("rules_version or security rules")
        server_side = any(signal in uses for signal in _FIREBASE_SERVER_SIGNALS)
        if not server_side and any(signal in uses for signal in _FIREBASE_CLIENT_SIGNALS):
            gaps.extend(
                marker for marker in ("firebaseconfig", "onsnapshot") if marker not in text
            )
    if _mentions_product(uses, "bolt") and "bolt.new" not in text:
        gaps.append("Bolt.new")
    if _mentions_product(uses, "lovable") and "lovable.dev" not in text:
        gaps.append("Lovable.dev")
    return sorted(set(gaps))


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


def _usage_text(payload: dict[str, Any]) -> str:
    """The parts of a lab that describe what it uses. See _USAGE_FIELDS."""
    parts = [
        json.dumps(payload.get(field), ensure_ascii=False)
        for field in _USAGE_FIELDS
        if payload.get(field)
    ]
    for step in payload.get("procedure_steps") or []:
        if not isinstance(step, dict):
            continue
        parts.extend(
            json.dumps(step.get(field), ensure_ascii=False)
            for field in _USAGE_STEP_FIELDS
            if step.get(field)
        )
    return " ".join(parts).lower()


def _mentions_product(text: str, name: str) -> bool:
    """Whether *name* appears as a bare product name rather than inside a word.

    Excludes hyphenated and dotted compounds — "bolt-on", "bolt-action",
    "e-bolt" — which are never the product, and which a plain substring test
    counted. What it cannot tell apart is a standalone English use of the word
    ("a bolt of lightning"); in a lab's title, objectives, environment or steps
    that is rare enough to be worth the occasional prompt to name the tool.
    """
    return re.search(rf"(?<![\w.-]){re.escape(name)}(?![\w.-])", text) is not None


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
