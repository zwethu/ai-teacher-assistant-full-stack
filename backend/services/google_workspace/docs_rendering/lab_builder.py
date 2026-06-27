"""LabDocBuilder — transforms LabFull into styled document blocks.

Copied from Pnai-ai/pnai/tools/google_docs/lab_builder.py with imports
adjusted to use local modules.
"""

from __future__ import annotations

import re
from typing import Literal

from services.google_workspace.docs_rendering.schemas import LabFull, LabModality
from services.google_workspace.docs_rendering.builder import BlockType, TableBlock, TextBlock
from services.artifact_renderers.code_blocks import normalize_code_block

Block = TextBlock | TableBlock

_SECTION_DIVIDER = "─" * 48


class LabDocBuilder:
    """Build lecturer or student lab Google Doc blocks from a LabFull."""

    def __init__(self, lab: LabFull, mode: Literal["lecturer", "student"]) -> None:
        self._lab = lab
        self._mode = mode

    def build(self) -> list[Block]:
        if self._mode == "lecturer":
            return self._build_lecturer()
        return self._build_student()

    @staticmethod
    def _append_section_divider(blocks: list[Block]) -> None:
        blocks.append(TextBlock(BlockType.DIVIDER, _SECTION_DIVIDER))

    def _build_lecturer(self) -> list[Block]:
        lab = self._lab
        blocks: list[Block] = []

        blocks.append(TextBlock(BlockType.TITLE, lab.title))
        blocks.append(
            TableBlock(
                headers=["Week", "Modality", "Duration", "Risk Level", "Batch"],
                rows=[
                    [
                        str(lab.week),
                        str(lab.modality),
                        f"{lab.duration_minutes} min",
                        str(lab.safety_profile.risk_level),
                        lab.batch_name or "—",
                    ]
                ],
            )
        )
        blocks.append(TextBlock(BlockType.DIVIDER, "―" * 48))

        blocks.append(TextBlock(BlockType.HEADING1, "Lesson Plan Alignment"))
        blocks.append(TextBlock(BlockType.BODY, lab.lesson_plan_alignment))
        self._append_section_divider(blocks)

        blocks.append(TextBlock(BlockType.HEADING1, "Learning Objectives"))
        for objective in lab.learning_objectives:
            blocks.append(TextBlock(BlockType.BULLET, objective))
        self._append_section_divider(blocks)

        blocks.append(TextBlock(BlockType.HEADING1, "Environment Setup"))
        env = lab.environment_profile
        env_lines = [
            f"Runtime: {env.runtime or 'N/A'}",
            f"Operating system: {env.operating_system or 'N/A'}",
            f"Sandbox: {env.sandbox_name or 'N/A'}",
            f"Internet required: {'Yes' if env.internet_required else 'No'}",
        ]
        for line in env_lines:
            blocks.append(TextBlock(BlockType.BODY, line))
        for label, items in (
            ("Required software", env.required_software),
            ("Required packages", env.required_packages),
            ("Hardware required", env.hardware_required),
            ("Materials required", env.materials_required),
            ("Access constraints", env.access_constraints),
        ):
            if items:
                blocks.append(TextBlock(BlockType.HEADING2, label))
                for item in items:
                    blocks.append(TextBlock(BlockType.BULLET, item))
        self._append_section_divider(blocks)

        blocks.append(TextBlock(BlockType.HEADING1, "Materials / Software / Equipment"))
        for item in lab.materials:
            blocks.append(TextBlock(BlockType.BULLET, item))
        self._append_section_divider(blocks)

        blocks.append(TextBlock(BlockType.HEADING1, "Safety and Risk Profile"))
        safety = lab.safety_profile
        blocks.append(TextBlock(BlockType.BODY, f"Risk level: {safety.risk_level}"))
        for note in lab.safety_notes:
            blocks.append(TextBlock(BlockType.BODY, f"Note: {note}", italic=True))
        for label, items in (
            ("Hazards", safety.hazards),
            ("PPE", safety.ppe),
            ("Required training", safety.required_training),
            ("Disposal notes", safety.disposal_notes),
            ("Prohibited actions", safety.prohibited_actions),
        ):
            if items:
                blocks.append(TextBlock(BlockType.HEADING2, label))
                for item in items:
                    blocks.append(TextBlock(BlockType.BULLET, item))
        blocks.append(
            TextBlock(
                BlockType.BODY,
                f"Supervision required: {'Yes' if safety.supervision_required else 'No'}",
            )
        )
        self._append_section_divider(blocks)

        blocks.append(TextBlock(BlockType.HEADING1, "Pre-Lab Lecturer Checklist"))
        for task in lab.pre_lab_tasks:
            blocks.append(TextBlock(BlockType.BULLET, task))
        self._append_section_divider(blocks)

        blocks.append(TextBlock(BlockType.HEADING1, "Session Timeline"))
        timeline_rows = [
            [str(step.step_number), step.title, str(step.estimated_minutes)]
            for step in lab.procedure_steps
        ]
        blocks.append(
            TableBlock(
                headers=["Step Number", "Title", "Est. Minutes"],
                rows=timeline_rows,
            )
        )
        self._append_section_divider(blocks)

        blocks.append(TextBlock(BlockType.HEADING1, "Instructor Walkthrough"))
        for step in lab.procedure_steps:
            if step.phase_title:
                blocks.append(TextBlock(BlockType.HEADING2, step.phase_title))
            blocks.append(
                TextBlock(BlockType.HEADING2, f"Step {step.step_number}: {step.title}")
            )
            rows = [
                ["Student sees", step.student_instruction],
                ["Lecturer note", step.lecturer_note or "—"],
                ["Expected result", step.expected_result or "—"],
                ["Evidence required", step.evidence_required or "—"],
                ["Est. time", f"{step.estimated_minutes} min"],
            ]
            blocks.append(TableBlock(headers=["Field", "Content"], rows=rows))
            self._append_rich_step_blocks(blocks, step, include_recovery=True)
            blocks.append(TextBlock(BlockType.BODY, ""))

        blocks.append(TextBlock(BlockType.HEADING1, "Checkpoints"))
        for checkpoint in lab.checkpoints:
            blocks.append(TextBlock(BlockType.HEADING2, checkpoint.title))
            checkpoint_rows = [
                ["When to check", checkpoint.when_to_check],
                ["Evidence required", checkpoint.evidence_required],
            ]
            if checkpoint.common_failure_modes:
                checkpoint_rows.append(
                    [
                        "Common failures",
                        "\n".join(f"• {mode}" for mode in checkpoint.common_failure_modes),
                    ]
                )
            if checkpoint.recovery_actions:
                checkpoint_rows.append(
                    [
                        "Recovery",
                        "\n".join(f"• {action}" for action in checkpoint.recovery_actions),
                    ]
                )
            blocks.append(
                TableBlock(headers=["Field", "Detail"], rows=checkpoint_rows)
            )
            blocks.append(TextBlock(BlockType.BODY, ""))

        blocks.append(TextBlock(BlockType.HEADING1, "Expected Results / Answer Key"))
        for item in lab.expected_results:
            blocks.append(TextBlock(BlockType.BULLET, item))

        if lab.callouts:
            blocks.append(TextBlock(BlockType.HEADING1, "Instructor Callouts"))
            for item in lab.callouts:
                blocks.append(TextBlock(BlockType.BODY, f"Note: {item}", italic=True))

        blocks.append(TextBlock(BlockType.HEADING1, "Troubleshooting Matrix"))
        trouble_rows = [self._troubleshooting_row(item) for item in lab.troubleshooting]
        for step in lab.procedure_steps:
            for index, error in enumerate(step.common_errors):
                recovery = step.recovery_actions[index] if index < len(step.recovery_actions) else ""
                trouble_rows.append([f"Step {step.step_number}: {error}", "", recovery])
        blocks.append(
            TableBlock(
                headers=["Issue", "Cause", "Fix"],
                rows=trouble_rows or [["—", "—", "—"]],
            )
        )

        blocks.append(TextBlock(BlockType.HEADING1, "Assessment Rubric"))
        blocks.append(self._build_rubric_table(lab.rubric))

        blocks.append(TextBlock(BlockType.HEADING1, "Cleanup / Reset Instructions"))
        cleanup_parts: list[str] = []
        if safety.disposal_notes:
            cleanup_parts.append(". ".join(safety.disposal_notes))
        if lab.modality == LabModality.coding_virtual.value or lab.modality == LabModality.coding_virtual:
            cleanup_parts.append(
                "Reset: delete test branches, restore mock data, close Codespaces."
            )
        blocks.append(
            TextBlock(
                BlockType.BODY,
                " ".join(cleanup_parts) if cleanup_parts else "No special cleanup required.",
            )
        )

        return blocks

    def _build_student(self) -> list[Block]:
        lab = self._lab
        blocks: list[Block] = []

        blocks.append(TextBlock(BlockType.TITLE, lab.title))

        blocks.append(TextBlock(BlockType.HEADING1, "What You Will Learn"))
        for objective in lab.learning_objectives:
            blocks.append(TextBlock(BlockType.BULLET, objective))

        blocks.append(TextBlock(BlockType.HEADING1, "Before You Start"))
        for task in lab.pre_lab_tasks:
            blocks.append(TextBlock(BlockType.BULLET, task))

        blocks.append(TextBlock(BlockType.HEADING1, "Tools / Materials"))
        for item in lab.materials:
            blocks.append(TextBlock(BlockType.BULLET, item))

        blocks.append(TextBlock(BlockType.HEADING1, "Safety / Acceptable-Use Notice"))
        safety = lab.safety_profile
        if safety.hazards:
            blocks.append(TextBlock(BlockType.HEADING2, "Hazards"))
            for item in safety.hazards:
                blocks.append(TextBlock(BlockType.BULLET, item))
        if safety.ppe:
            blocks.append(TextBlock(BlockType.HEADING2, "PPE"))
            for item in safety.ppe:
                blocks.append(TextBlock(BlockType.BULLET, item))

        blocks.append(TextBlock(BlockType.HEADING1, "Scenario or Problem Statement"))
        blocks.append(TextBlock(BlockType.BODY, lab.student_overview))

        blocks.append(TextBlock(BlockType.HEADING1, "Step-by-Step Procedure"))
        for step in lab.procedure_steps:
            if step.phase_title:
                blocks.append(TextBlock(BlockType.HEADING2, step.phase_title))
            blocks.append(
                TextBlock(BlockType.HEADING2, f"Step {step.step_number}: {step.title}")
            )
            if step.student_actions:
                for action in step.student_actions:
                    blocks.append(TextBlock(BlockType.BULLET, action))
            else:
                raw = step.student_instruction.strip()
                sub_steps = re.split(r"(?<=[.!?])\s+(?=Step\s+\d)", raw)
                if len(sub_steps) > 1:
                    for sub in sub_steps:
                        if sub.strip():
                            blocks.append(TextBlock(BlockType.BULLET, sub.strip()))
                else:
                    blocks.append(TextBlock(BlockType.BODY, raw))
            self._append_rich_step_blocks(blocks, step, include_recovery=False)
            blocks.append(
                TextBlock(BlockType.BODY, f"⏱ Estimated time: {step.estimated_minutes} min")
            )
            if step.evidence_required:
                blocks.append(TextBlock(BlockType.BODY, f"Evidence required: {step.evidence_required}"))
            blocks.append(TextBlock(BlockType.BODY, ""))

        blocks.append(TextBlock(BlockType.HEADING1, "Checkpoints"))
        for checkpoint in lab.checkpoints:
            blocks.append(TextBlock(BlockType.HEADING2, checkpoint.title))
            blocks.append(
                TextBlock(
                    BlockType.BODY,
                    f"✔ Show your work: {checkpoint.evidence_required}",
                )
            )
            blocks.append(TextBlock(BlockType.BODY, ""))

        blocks.append(TextBlock(BlockType.HEADING1, "What to Submit"))
        for item in lab.deliverables:
            blocks.append(TextBlock(BlockType.BULLET, item))
        if lab.submission_checklist:
            blocks.append(TextBlock(BlockType.HEADING2, "Submission Checklist"))
            for item in lab.submission_checklist:
                blocks.append(TextBlock(BlockType.BULLET, f"☐ {item}"))

        blocks.append(TextBlock(BlockType.HEADING1, "Reflection Questions"))
        for index, question in enumerate(lab.post_lab_questions, start=1):
            blocks.append(TextBlock(BlockType.BODY, f"{index}. {question}"))

        blocks.append(TextBlock(BlockType.HEADING1, "Rubric Summary"))
        blocks.append(self._build_rubric_table(lab.rubric, student_view=True))

        return blocks

    @staticmethod
    def _troubleshooting_row(item: dict) -> list[str]:
        if "issue" in item or "cause" in item or "fix" in item:
            return [
                str(item.get("issue", "")),
                str(item.get("cause", "")),
                str(item.get("fix", "")),
            ]
        values = list(item.values())
        while len(values) < 3:
            values.append("")
        return [str(values[0]), str(values[1]), str(values[2])]

    @classmethod
    def _append_rich_step_blocks(
        cls,
        blocks: list[Block],
        step: object,
        *,
        include_recovery: bool,
    ) -> None:
        prompt_templates = getattr(step, "prompt_templates", []) or []
        prompt_templates = [str(prompt).strip() for prompt in prompt_templates if str(prompt).strip()]
        if prompt_templates:
            blocks.append(TextBlock(BlockType.HEADING2, "Prompt Templates"))
            for prompt in prompt_templates:
                blocks.append(TextBlock(BlockType.BODY, f"> {prompt}"))

        for heading, values in (
            ("Code Blocks", getattr(step, "code_blocks", []) or []),
            ("Configuration Templates", getattr(step, "config_templates", []) or []),
        ):
            normalized_values = [
                normalized
                for value in values
                if (normalized := normalize_code_block(value)) is not None
            ]
            if normalized_values:
                blocks.append(TextBlock(BlockType.HEADING2, heading))
                for normalized in normalized_values:
                    if normalized["title"]:
                        blocks.append(TextBlock(BlockType.META, normalized["title"], bold=True))
                    blocks.append(TextBlock(BlockType.CODE, normalized["code"]))

        if include_recovery and (getattr(step, "common_errors", []) or getattr(step, "recovery_actions", [])):
            errors = getattr(step, "common_errors", []) or []
            recoveries = getattr(step, "recovery_actions", []) or []
            row_count = max(len(errors), len(recoveries), 1)
            rows = [
                [
                    str(errors[index]) if index < len(errors) else "",
                    str(recoveries[index]) if index < len(recoveries) else "",
                ]
                for index in range(row_count)
            ]
            blocks.append(TableBlock(headers=["Common Error", "Recovery Action"], rows=rows))

    @staticmethod
    def _format_code_block(block: dict | str) -> str:
        normalized = normalize_code_block(block)
        return normalized["code"] if normalized else ""

    @staticmethod
    def _rubric_item_dict(item: dict | object) -> dict:
        if hasattr(item, "model_dump"):
            return item.model_dump()
        return dict(item)

    @classmethod
    def _rubric_has_full_descriptions(cls, item: dict | object) -> bool:
        data = cls._rubric_item_dict(item)
        required = ("criterion", "excellent", "satisfactory", "needs_work")
        if not all(key in data for key in required):
            return False
        levels = (
            str(data["excellent"]).strip(),
            str(data["satisfactory"]).strip(),
            str(data["needs_work"]).strip(),
        )
        return all(levels) and len(set(levels)) >= 2

    @classmethod
    def _build_rubric_table(
        cls,
        rubric: list,
        *,
        student_view: bool = False,
    ) -> TableBlock:
        if not rubric:
            return TableBlock(headers=["Criterion", "Excellent", "Satisfactory", "Needs Work"], rows=[["—", "—", "—", "—"]])

        use_full = all(cls._rubric_has_full_descriptions(item) for item in rubric)
        if use_full:
            has_points = any(cls._rubric_item_dict(item).get("points") is not None for item in rubric)
            if has_points:
                headers = ["Criterion", "Points", "Excellent", "Satisfactory", "Needs Work"]
                rows = [cls._rubric_row(item, include_points=True) for item in rubric]
            else:
                headers = ["Criterion", "Excellent", "Satisfactory", "Needs Work"]
                rows = [cls._rubric_row(item, include_points=False) for item in rubric]
            if student_view and has_points:
                headers = ["Criterion", "Points", "What excellent work looks like"]
                rows = [
                    [
                        cls._rubric_item_dict(item)["criterion"],
                        str(cls._rubric_item_dict(item).get("points") or "—"),
                        cls._rubric_item_dict(item)["excellent"],
                    ]
                    for item in rubric
                ]
            return TableBlock(headers=headers, rows=rows)

        rows = [cls._rubric_points_row(item) for item in rubric]
        return TableBlock(headers=["Criterion", "Max points"], rows=rows or [["—", "—"]])

    @staticmethod
    def _rubric_points_row(item: dict | object) -> list[str]:
        data = LabDocBuilder._rubric_item_dict(item)
        criterion = str(data.get("criterion") or data.get("name") or "—").strip()
        points = data.get("points")
        return [criterion or "—", str(points) if points is not None else "—"]

    @staticmethod
    def _rubric_row(item: dict | object, *, include_points: bool) -> list[str]:
        data = LabDocBuilder._rubric_item_dict(item)
        base = [
            str(data["criterion"]),
            str(data["excellent"]),
            str(data["satisfactory"]),
            str(data["needs_work"]),
        ]
        if include_points:
            return [base[0], str(data.get("points") or "—"), base[1], base[2], base[3]]
        return base
