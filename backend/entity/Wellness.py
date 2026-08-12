from pydantic import BaseModel, Field


class StressState(BaseModel):
    stress_score: float = 0.0
    warning: bool = False
    blocked: bool = False
    breathing_used_today: bool = False
    journaled_today: bool = False


class StressIncreaseRequest(BaseModel):
    """Client-reported stress bump (rapid clicking). Server clamps the amount."""

    amount: float = Field(default=5.0, ge=0)


class BreathingResult(StressState):
    stress_reduced: bool = False
    prompt_reflection: bool = False
    message: str = ""


class JournalCreate(BaseModel):
    mood: str
    notes: str = ""


class JournalEntryModel(BaseModel):
    id: str
    uid: str
    mood: str
    notes: str = ""
    entry_type: str = "after_breathing"
    stress_score: float = 0.0
    stress_reduced: bool = False
    created_at: str | None = None
