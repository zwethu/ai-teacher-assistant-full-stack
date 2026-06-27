"""Canonical lab markdown preview rendered from content_json."""

from __future__ import annotations

from typing import Any

from services.google_workspace.docs_rendering.schemas import LabFull
from services.artifact_renderers.code_blocks import render_code_block

RENDERER_VERSION = "lab_markdown.v1"


def render_lab_markdown(payload: dict[str, Any]) -> str:
    lab = LabFull.model_validate(payload)
    lines: list[str] = [
        f"# {lab.title}",
        "",
        (
            f"Week: {lab.week} | Topic: {lab.topic} | "
            f"Duration: {lab.duration_minutes} minutes | Modality: {lab.modality}"
        ),
        "",
        "## Learning Objectives",
    ]
    lines.extend(f"- {item}" for item in lab.learning_objectives)

    lines.extend(["", "## Environment Setup"])
    env = lab.environment_profile
    lines.extend(
        [
            f"- Runtime: {env.runtime or 'N/A'}",
            f"- Operating system: {env.operating_system or 'N/A'}",
            f"- Sandbox: {env.sandbox_name or 'N/A'}",
            f"- Internet required: {'Yes' if env.internet_required else 'No'}",
        ]
    )
    _append_list(lines, "Required Software", env.required_software)
    _append_list(lines, "Required Packages", env.required_packages)
    _append_list(lines, "Materials", lab.materials)
    _append_list(lines, "Safety Notes", lab.safety_notes)
    _append_list(lines, "Access Constraints", env.access_constraints)

    safety = lab.safety_profile
    lines.extend(["", "## Safety / Acceptable Use", f"**Risk level:** {safety.risk_level}"])
    _append_list(lines, "Hazards", safety.hazards)
    _append_list(lines, "PPE", safety.ppe)
    _append_list(lines, "Prohibited Actions", safety.prohibited_actions)
    if lab.lecturer_setup:
        lines.extend(["", "## Lecturer Setup", lab.lecturer_setup])

    if lab.lesson_plan_alignment:
        lines.extend(["", "## Lesson Plan Alignment", lab.lesson_plan_alignment])
    if lab.student_overview:
        lines.extend(["", "## Scenario / Student Overview", lab.student_overview])

    _append_list(lines, "Pre-Lab Tasks", lab.pre_lab_tasks)

    lines.extend(["", "## Procedure Steps"])
    for step in lab.procedure_steps:
        if step.phase_title:
            lines.extend(["", f"### {step.phase_title}"])
        lines.extend(["", f"### Step {step.step_number}: {step.title}"])
        if step.student_actions:
            _append_list(lines, "Student Actions", step.student_actions)
        elif step.student_instruction:
            lines.append(step.student_instruction)
        if step.lecturer_note:
            lines.extend(["", f"Lecturer note: {step.lecturer_note}"])
        if step.expected_result:
            lines.extend(["", f"Expected result: {step.expected_result}"])
        if step.evidence_required:
            lines.extend(["", f"Evidence required: {step.evidence_required}"])
        _append_code_blocks(lines, "Prompt Templates", step.prompt_templates, quote=True)
        _append_code_blocks(lines, "Code Blocks", step.code_blocks)
        _append_code_blocks(lines, "Configuration Templates", step.config_templates)
        _append_list(lines, "Common Errors", step.common_errors)
        _append_list(lines, "Recovery Actions", step.recovery_actions)

    lines.extend(["", "## Checkpoints"])
    for checkpoint in lab.checkpoints:
        lines.extend(
            [
                "",
                f"### {checkpoint.title}",
                f"- When: {checkpoint.when_to_check}",
                f"- Evidence: {checkpoint.evidence_required}",
            ]
        )
        _append_list(lines, "Common Failure Modes", checkpoint.common_failure_modes)
        _append_list(lines, "Recovery Actions", checkpoint.recovery_actions)

    _append_list(lines, "Expected Results", lab.expected_results)
    _append_list(lines, "Deliverables", lab.deliverables)
    _append_list(lines, "Submission Checklist", [f"[ ] {item}" for item in lab.submission_checklist])
    _append_list(lines, "Callouts", lab.callouts)
    _append_list(lines, "Reflection Questions", lab.post_lab_questions)

    if lab.troubleshooting:
        lines.extend(["", "## Troubleshooting", "", "| Issue | Cause | Recovery |", "|---|---|---|"])
        for item in lab.troubleshooting:
            if isinstance(item, dict):
                lines.append(f"| {item.get('issue', '')} | {item.get('cause', '')} | {item.get('fix') or item.get('recovery', '')} |")

    if lab.rubric:
        lines.extend(["", "## Rubric"])
        lines.extend(["", "| Criterion | Excellent | Satisfactory | Needs Work | Points |", "|---|---|---|---|---:|"])
        for item in lab.rubric:
            lines.append(f"| {item.criterion} | {item.excellent} | {item.satisfactory} | {item.needs_work} | {item.points or ''} |")

    return "\n".join(line for line in lines if line is not None).strip()


def _append_list(lines: list[str], title: str, values: list[str]) -> None:
    if not values:
        return
    lines.extend(["", f"## {title}"])
    lines.extend(f"- {value}" for value in values)


def _append_code_blocks(
    lines: list[str],
    title: str,
    values: list[dict[str, Any] | str],
    *,
    quote: bool = False,
) -> None:
    rendered: list[str] = []
    for value in values:
        if quote:
            text = _snippet_text(value)
            if text:
                rendered.extend(f"> {line}" for line in text.splitlines())
            continue
        rendered.extend(render_code_block(value))
    if rendered:
        lines.extend(["", f"## {title}", *rendered])


def _snippet_text(value: dict[str, Any] | str) -> str:
    if isinstance(value, dict):
        return str(
            value.get("code")
            or value.get("content")
            or value.get("text")
            or value.get("value")
            or ""
        ).strip()
    return str(value or "").strip()
