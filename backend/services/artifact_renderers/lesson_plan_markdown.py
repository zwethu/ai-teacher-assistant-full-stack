"""Canonical lesson-plan markdown preview rendered from content_json."""

from __future__ import annotations

from typing import Any

from services.google_workspace.docs_rendering.schemas import LessonPlanFull

RENDERER_VERSION = "lesson_plan_markdown.v1"


def render_lesson_plan_markdown(payload: dict[str, Any]) -> str:
    plan = LessonPlanFull.model_validate(payload)
    lines: list[str] = [
        f"# {plan.title}",
        "",
        (
            f"Subject: {plan.subject} | Week: {plan.week} | "
            f"Duration: {plan.lecture_duration} minutes | Type: {plan.lesson_plan_type}"
        ),
        "",
        "## Learning Objectives",
    ]
    lines.extend(f"- {item.objective} ({item.bloom_level})" for item in plan.objectives)

    if plan.prerequisites:
        lines.extend(["", "## Prerequisites"])
        lines.extend(f"- {item}" for item in plan.prerequisites)

    if plan.materials:
        lines.extend(["", "## Materials"])
        lines.extend(f"- {item}" for item in plan.materials)

    if plan.detailed_timeline:
        lines.extend(["", "## Lesson Timeline"])
        for segment in plan.detailed_timeline:
            lines.append(
                f"- **{segment.start_minute}-{segment.end_minute} min:** "
                f"{segment.activity}"
                + (f" — {segment.instructor_notes}" if segment.instructor_notes else "")
            )

    lines.extend(["", "## Lesson Activities"])
    for activity in plan.activities:
        lines.extend(
            [
                "",
                f"### {activity.title}",
                f"{activity.duration_minutes} min | {activity.activity_type}",
                "",
                activity.description,
            ]
        )
        _append_list(lines, "Teacher Actions", activity.teacher_actions)
        _append_list(lines, "Student Actions", activity.student_actions)
        _append_list(lines, "Instructions", activity.instructions)
        _append_list(lines, "Assessment Checks", activity.assessment_checks)
        _append_code_blocks(lines, "Prompt Templates", activity.prompt_templates, quote=True)
        _append_code_blocks(lines, "Code / Configuration Blocks", activity.code_blocks)
        _append_list(lines, "Learning Outcomes", activity.learning_outcomes)

    lines.extend(
        [
            "",
            "## Assessment",
            f"### {plan.assessment.title}",
            plan.assessment.description,
        ]
    )
    _append_list(lines, "Tasks", plan.assessment.questions_or_tasks)
    if plan.assessment.rubric:
        lines.extend(["", f"Rubric: {plan.assessment.rubric}"])

    lines.extend(["", "## Differentiation"])
    _append_list(lines, "Support", plan.differentiation.support_strategies)
    _append_list(lines, "Challenge", plan.differentiation.challenge_strategies)
    _append_list(lines, "Accommodations", plan.differentiation.accommodations)

    lines.extend(["", "## Homework", f"### {plan.homework.title}", plan.homework.description])
    _append_list(lines, "Tasks", plan.homework.tasks)

    if plan.teacher_notes:
        lines.extend(["", "## Teacher Notes", plan.teacher_notes])

    if plan.sources:
        lines.extend(["", "## Sources"])
        for source in plan.sources:
            label = source.file_title or source.title
            suffix = f" — {source.url}" if source.url else ""
            lines.append(f"- [{source.source_type}] {label}{suffix}")

    return "\n".join(line for line in lines if line is not None).strip()


def _append_list(lines: list[str], title: str, values: list[str]) -> None:
    if not values:
        return
    lines.extend(["", f"#### {title}"])
    lines.extend(f"- {value}" for value in values)


def _append_code_blocks(
    lines: list[str],
    title: str,
    values: list[dict[str, Any] | str],
    *,
    quote: bool = False,
) -> None:
    if not values:
        return
    lines.extend(["", f"#### {title}"])
    for value in values:
        if quote:
            lines.append(f"> {value}")
            continue
        if isinstance(value, str):
            lines.extend(["```", value, "```"])
        else:
            language = str(value.get("language") or value.get("type") or "")
            code = str(value.get("code") or value.get("content") or value.get("text") or "")
            title_value = str(value.get("title") or "")
            if title_value:
                lines.append(f"**{title_value}**")
            lines.extend([f"```{language}", code, "```"])

