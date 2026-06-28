from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator


class CourseBlueprintWeeklyPlanItem(BaseModel):
    week: int = Field(ge=1, le=104)
    theme: str = Field(min_length=1, max_length=300)
    lesson_goal: str | None = Field(default=None, max_length=2000)
    lab_goal: str | None = Field(default=None, max_length=2000)
    assessment_idea: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)


class CourseBlueprintContent(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    summary: str = Field(default="", max_length=8000)
    weekly_plan: list[CourseBlueprintWeeklyPlanItem] = Field(default_factory=list, max_length=104)
    assessment_strategy: str = Field(default="", max_length=8000)
    lab_strategy: str = Field(default="", max_length=8000)
    teaching_preferences: dict[str, str] = Field(default_factory=dict)
    open_questions: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("title", "summary", "assessment_strategy", "lab_strategy")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("teaching_preferences")
    @classmethod
    def validate_preferences(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 50:
            raise ValueError("teaching_preferences cannot contain more than 50 entries")
        cleaned: dict[str, str] = {}
        for key, item in value.items():
            clean_key = key.strip()
            clean_value = item.strip()
            if not clean_key or not clean_value:
                continue
            if len(clean_key) > 200 or len(clean_value) > 2000:
                raise ValueError("teaching preference keys or values are too long")
            cleaned[clean_key] = clean_value
        return cleaned

    @field_validator("open_questions")
    @classmethod
    def clean_questions(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        if any(len(item) > 2000 for item in cleaned):
            raise ValueError("open question is too long")
        return cleaned

    @model_validator(mode="after")
    def validate_plan(self) -> "CourseBlueprintContent":
        weeks = [item.week for item in self.weekly_plan]
        if len(weeks) != len(set(weeks)):
            raise ValueError("weekly_plan week numbers must be unique")
        self.weekly_plan.sort(key=lambda item: item.week)
        if not any(
            (
                self.summary,
                self.weekly_plan,
                self.assessment_strategy,
                self.lab_strategy,
                self.teaching_preferences,
                self.open_questions,
            )
        ):
            raise ValueError("at least one substantive planning field is required")
        return self


class CourseBlueprintFromMessageRequest(CourseBlueprintContent):
    source_chat_id: str = Field(min_length=1, max_length=200)
    source_message_id: str = Field(min_length=1, max_length=200)
    source_run_id: str = Field(default="", max_length=200)


class CourseBlueprintUpdateRequest(CourseBlueprintContent):
    pass
