"""DocBuilder — transforms LessonPlanFull into styled document blocks.

Copied from Pnai-ai/pnai/tools/google_docs/builder.py with imports
adjusted to use the local schemas module.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from services.google_workspace.docs_rendering.schemas import LessonPlanFull
from services.artifact_renderers.code_blocks import normalize_code_block


class BlockType(str, Enum):
    TITLE = "title"
    HEADING1 = "heading1"
    HEADING2 = "heading2"
    META = "meta"
    BODY = "body"
    BULLET = "bullet"
    TABLE = "table"
    DIVIDER = "divider"
    CODE = "code"


@dataclass
class TextBlock:
    block_type: BlockType
    text: str
    bold: bool = False
    italic: bool = False
    color: tuple[float, float, float] | None = None


@dataclass
class TableBlock:
    headers: list[str]
    rows: list[list[str]]
    header_bg: tuple[float, float, float] | None = None


Block = TextBlock | TableBlock


class DocBuilder:
    """Walk LessonPlanFull fields in document order and emit blocks."""

    def __init__(self, lesson_plan: LessonPlanFull) -> None:
        self._plan = lesson_plan

    def build(self) -> list[Block]:
        p = self._plan
        blocks: list[Block] = []

        blocks.append(TextBlock(BlockType.TITLE, p.title))

        meta_parts = [
            f"Subject: {p.subject}",
            f"Grade: {p.grade}",
            f"Batch: {p.batch_name}",
            f"Week: {p.week}",
            f"Duration: {p.lecture_duration} minutes",
            f"Difficulty: {p.difficulty}",
            f"Type: {p.lesson_plan_type}",
            f"Approach: {p.teaching_approach}",
        ]
        if p.date:
            meta_parts.append(f"Date: {p.date}")
        blocks.append(TextBlock(BlockType.META, "  |  ".join(meta_parts)))
        blocks.append(TextBlock(BlockType.DIVIDER, "―" * 48))

        blocks.append(TextBlock(BlockType.HEADING1, "Learning Objectives"))
        for obj in p.objectives:
            blocks.append(
                TextBlock(
                    BlockType.BULLET,
                    f"{obj.objective}  (Bloom: {obj.bloom_level})",
                )
            )

        if p.prerequisites:
            blocks.append(TextBlock(BlockType.HEADING1, "Prerequisites"))
            for item in p.prerequisites:
                blocks.append(TextBlock(BlockType.BULLET, item))

        if p.detailed_timeline:
            blocks.append(TextBlock(BlockType.HEADING1, "Lesson Timeline"))
            timeline_rows: list[list[str]] = []
            for seg in p.detailed_timeline:
                time_label = f"{seg.start_minute}–{seg.end_minute} min"
                timeline_rows.append(
                    [time_label, seg.activity, seg.instructor_notes or ""]
                )
            blocks.append(
                TableBlock(
                    headers=["Time", "Activity", "Instructor Notes"],
                    rows=timeline_rows,
                )
            )

        if p.materials:
            blocks.append(TextBlock(BlockType.HEADING1, "Materials"))
            for item in p.materials:
                blocks.append(TextBlock(BlockType.BULLET, item))

        if p.type_specific_plan:
            blocks.append(TextBlock(BlockType.HEADING1, "Type-Specific Plan"))
            for key, value in p.type_specific_plan.items():
                label = str(key).replace("_", " ").title()
                if isinstance(value, list):
                    blocks.append(TextBlock(BlockType.HEADING2, label))
                    for item in value:
                        blocks.append(TextBlock(BlockType.BULLET, str(item)))
                else:
                    blocks.append(TextBlock(BlockType.BODY, f"{label}: {value}"))

        blocks.append(TextBlock(BlockType.HEADING1, "Lesson Activities"))
        for activity in p.activities:
            blocks.append(
                TextBlock(
                    BlockType.HEADING2,
                    f"{activity.title}  ({activity.duration_minutes} min — {activity.activity_type})",
                )
            )
            blocks.append(TextBlock(BlockType.BODY, activity.description))
            if activity.teacher_actions:
                blocks.append(TextBlock(BlockType.HEADING2, "Teacher Actions"))
                for action in activity.teacher_actions:
                    blocks.append(TextBlock(BlockType.BULLET, action))
            if activity.student_actions:
                blocks.append(TextBlock(BlockType.HEADING2, "Student Actions"))
                for action in activity.student_actions:
                    blocks.append(TextBlock(BlockType.BULLET, action))
            for step in activity.instructions:
                blocks.append(TextBlock(BlockType.BULLET, step))
            if activity.materials_table:
                rows = [
                    [
                        str(item.get("item") or item.get("name") or ""),
                        str(item.get("purpose") or item.get("use") or item.get("notes") or ""),
                    ]
                    for item in activity.materials_table
                ]
                blocks.append(TableBlock(headers=["Material", "Purpose"], rows=rows))
            if activity.prompt_templates:
                prompts = [str(prompt).strip() for prompt in activity.prompt_templates if str(prompt).strip()]
                if prompts:
                    blocks.append(TextBlock(BlockType.HEADING2, "Prompt Templates"))
                    for prompt in prompts:
                        blocks.append(TextBlock(BlockType.BODY, f"> {prompt}"))
            if activity.code_blocks:
                normalized_blocks = [
                    normalized
                    for block in activity.code_blocks
                    if (normalized := normalize_code_block(block)) is not None
                ]
                if normalized_blocks:
                    blocks.append(TextBlock(BlockType.HEADING2, "Code / Configuration Blocks"))
                for normalized in normalized_blocks:
                    if normalized["title"]:
                        blocks.append(TextBlock(BlockType.META, normalized["title"], bold=True))
                    blocks.append(TextBlock(BlockType.CODE, normalized["code"]))
            if activity.assessment_checks:
                blocks.append(TextBlock(BlockType.HEADING2, "Assessment Checks"))
                for check in activity.assessment_checks:
                    blocks.append(TextBlock(BlockType.BULLET, check))
            for outcome in activity.learning_outcomes:
                blocks.append(
                    TextBlock(BlockType.BULLET, f"Outcome: {outcome}", italic=True)
                )
            if activity.materials_needed:
                materials = ", ".join(activity.materials_needed)
                blocks.append(
                    TextBlock(
                        BlockType.BODY,
                        f"Materials: {materials}",
                        italic=True,
                    )
                )

        blocks.append(TextBlock(BlockType.HEADING1, "Assessment"))
        blocks.append(
            TextBlock(
                BlockType.HEADING2,
                f"{p.assessment.title}  ({p.assessment.type}, {p.assessment.estimated_time} min)",
            )
        )
        blocks.append(TextBlock(BlockType.BODY, p.assessment.description))
        for item in p.assessment.questions_or_tasks:
            blocks.append(TextBlock(BlockType.BULLET, item))
        if p.assessment.rubric:
            blocks.append(
                TextBlock(BlockType.BODY, f"Rubric: {p.assessment.rubric}", italic=True)
            )

        blocks.append(TextBlock(BlockType.HEADING1, "Differentiation"))
        support = p.differentiation.support_strategies
        challenge = p.differentiation.challenge_strategies
        max_rows = max(len(support), len(challenge))
        diff_rows = [
            [
                support[i] if i < len(support) else "",
                challenge[i] if i < len(challenge) else "",
            ]
            for i in range(max_rows)
        ]
        blocks.append(
            TableBlock(headers=["Support Strategies", "Challenge Strategies"], rows=diff_rows)
        )
        if p.differentiation.accommodations:
            for acc in p.differentiation.accommodations:
                blocks.append(TextBlock(BlockType.BULLET, f"Accommodation: {acc}"))

        blocks.append(TextBlock(BlockType.HEADING1, "Homework"))
        blocks.append(
            TextBlock(
                BlockType.HEADING2,
                (
                    f"{p.homework.title}  ({p.homework.estimated_time} min, "
                    f"due in {p.homework.due_date_offset} days)"
                ),
            )
        )
        blocks.append(TextBlock(BlockType.BODY, p.homework.description))
        for task in p.homework.tasks:
            blocks.append(TextBlock(BlockType.BULLET, task))
        for resource in p.homework.resources_needed:
            blocks.append(TextBlock(BlockType.BULLET, f"Resource: {resource}"))

        if p.teacher_notes:
            blocks.append(TextBlock(BlockType.HEADING1, "Teacher Notes"))
            blocks.append(TextBlock(BlockType.BODY, p.teacher_notes))

        if p.sources:
            blocks.append(TextBlock(BlockType.HEADING1, "Sources"))
            for src in p.sources:
                label = "[course_material]" if src.source_type == "course_material" else "[web]"
                parts = [label, src.title]
                if src.file_title and src.file_title != src.title:
                    parts.append(f"({src.file_title})")
                if src.page_number is not None:
                    parts.append(f"p.{src.page_number}")
                if src.url:
                    parts.append(f"— {src.url}")
                if src.snippet:
                    parts.append(f"— {src.snippet[:200]}")
                blocks.append(TextBlock(BlockType.BULLET, " ".join(parts)))

        return blocks

    @staticmethod
    def _format_code_block(block: dict | str) -> str:
        normalized = normalize_code_block(block)
        return normalized["code"] if normalized else ""
