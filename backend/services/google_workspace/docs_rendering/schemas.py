"""Lightweight Pydantic schema stubs for Google Docs rendering.

These mirror the fields consumed by ``DocBuilder`` and ``LabDocBuilder``.
They accept the same JSON payloads that Pnai-ai schemas produce, but without
the heavy validator logic (timeline continuity, rubric sum, etc.) that only
the agent side needs.

When Pnai-ai calls the backend, the payload has already been validated by the
agent's own schemas, so we just need enough structure for the builders to work.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Lesson Plan schemas (used by DocBuilder)
# ---------------------------------------------------------------------------


class SourceCitation(BaseModel):
    title: str = ""
    source_type: Literal["course_material", "web"] = "web"
    snippet: str = ""
    url: str | None = None
    file_title: str | None = None
    page_number: int | None = None
    relevance_score: float | None = None


class LearningObjective(BaseModel):
    objective: str
    bloom_level: str


class TeachingActivity(BaseModel):
    title: str
    description: str
    duration_minutes: int = 1
    activity_type: str = ""
    materials_needed: list[str] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)
    learning_outcomes: list[str] = Field(default_factory=list)
    teacher_actions: list[str] = Field(default_factory=list)
    student_actions: list[str] = Field(default_factory=list)
    materials_table: list[dict[str, Any]] = Field(default_factory=list)
    prompt_templates: list[str] = Field(default_factory=list)
    code_blocks: list[dict[str, Any] | str] = Field(default_factory=list)
    assessment_checks: list[str] = Field(default_factory=list)


class TimelineSegment(BaseModel):
    start_minute: int = 0
    duration: int = 1
    activity: str = ""
    instructor_notes: str | None = None

    @property
    def end_minute(self) -> int:
        return self.start_minute + self.duration


class Assessment(BaseModel):
    type: str = "formative"
    title: str = ""
    description: str = ""
    questions_or_tasks: list[str] = Field(default_factory=list)
    rubric: str | None = None
    estimated_time: int = 10


class Differentiation(BaseModel):
    support_strategies: list[str] = Field(default_factory=list)
    challenge_strategies: list[str] = Field(default_factory=list)
    accommodations: list[str] = Field(default_factory=list)


class Homework(BaseModel):
    title: str = ""
    description: str = ""
    tasks: list[str] = Field(default_factory=list)
    estimated_time: int = 30
    due_date_offset: int = 7
    resources_needed: list[str] = Field(default_factory=list)


class LessonPlanFull(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    title: str
    subject: str = ""
    batch_name: str = ""
    week: int = 1
    grade: str = ""
    lecture_duration: int = 60
    difficulty: str = "medium"
    teaching_approach: str = "mixed"
    lesson_plan_type: str = "standard"
    prior_knowledge: str = ""
    date: str | None = None
    type_specific_plan: dict[str, Any] = Field(default_factory=dict)
    objectives: list[LearningObjective] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    detailed_timeline: list[TimelineSegment] = Field(default_factory=list)
    activities: list[TeachingActivity] = Field(default_factory=list)
    assessment: Assessment = Field(default_factory=Assessment)
    differentiation: Differentiation = Field(default_factory=Differentiation)
    homework: Homework = Field(default_factory=Homework)
    teacher_notes: str = ""
    sources: list[SourceCitation] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Lab schemas (used by LabDocBuilder)
# ---------------------------------------------------------------------------


class LabModality(str, Enum):
    coding_virtual = "coding_virtual"
    data_analysis = "data_analysis"
    simulation = "simulation"
    hardware_physical = "hardware_physical"
    wet_lab = "wet_lab"
    field_observation = "field_observation"
    design_workshop = "design_workshop"


class LabRiskLevel(str, Enum):
    low = "low"
    moderate = "moderate"
    high = "high"


class EnvironmentProfile(BaseModel):
    modality: LabModality = LabModality.coding_virtual
    operating_system: str | None = None
    runtime: str | None = None
    required_software: list[str] = Field(default_factory=list)
    required_packages: list[str] = Field(default_factory=list)
    hardware_required: list[str] = Field(default_factory=list)
    materials_required: list[str] = Field(default_factory=list)
    internet_required: bool = False
    sandbox_name: str | None = None
    access_constraints: list[str] = Field(default_factory=list)


class SafetyProfile(BaseModel):
    risk_level: LabRiskLevel = LabRiskLevel.low
    hazards: list[str] = Field(default_factory=list)
    ppe: list[str] = Field(default_factory=list)
    required_training: list[str] = Field(default_factory=list)
    supervision_required: bool = True
    disposal_notes: list[str] = Field(default_factory=list)
    prohibited_actions: list[str] = Field(default_factory=list)


class LabStep(BaseModel):
    step_number: int = 1
    title: str = ""
    phase_title: str | None = None
    student_instruction: str = ""
    student_actions: list[str] = Field(default_factory=list)
    prompt_templates: list[str] = Field(default_factory=list)
    code_blocks: list[dict[str, Any] | str] = Field(default_factory=list)
    config_templates: list[dict[str, Any] | str] = Field(default_factory=list)
    common_errors: list[str] = Field(default_factory=list)
    recovery_actions: list[str] = Field(default_factory=list)
    evidence_required: str | None = None
    lecturer_note: str | None = None
    estimated_minutes: int = 10
    expected_result: str | None = None


class LabCheckpoint(BaseModel):
    title: str = ""
    when_to_check: str = ""
    evidence_required: str = ""
    common_failure_modes: list[str] = Field(default_factory=list)
    recovery_actions: list[str] = Field(default_factory=list)


class LabRubricCriterion(BaseModel):
    criterion: str = ""
    excellent: str = ""
    satisfactory: str = ""
    needs_work: str = ""
    points: int | None = None


class LabFull(BaseModel):
    model_config = ConfigDict(use_enum_values=True)

    title: str
    week: int = 1
    topic: str = ""
    batch_name: str = ""
    modality: LabModality = LabModality.coding_virtual
    duration_minutes: int = 60
    learning_objectives: list[str] = Field(default_factory=list)
    lesson_plan_alignment: str = ""
    prior_week_bridge: str | None = None
    environment_profile: EnvironmentProfile = Field(default_factory=EnvironmentProfile)
    safety_profile: SafetyProfile = Field(default_factory=SafetyProfile)
    lecturer_setup: str = ""
    student_overview: str = ""
    pre_lab_tasks: list[str] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    procedure_steps: list[LabStep] = Field(default_factory=list)
    checkpoints: list[LabCheckpoint] = Field(default_factory=list)
    expected_results: list[str] = Field(default_factory=list)
    troubleshooting: list[dict] = Field(default_factory=list)
    deliverables: list[str] = Field(default_factory=list)
    submission_checklist: list[str] = Field(default_factory=list)
    callouts: list[str] = Field(default_factory=list)
    safety_notes: list[str] = Field(default_factory=list)
    post_lab_questions: list[str] = Field(default_factory=list)
    rubric: list[LabRubricCriterion] = Field(default_factory=list)
