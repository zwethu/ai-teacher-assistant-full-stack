from pydantic import BaseModel, Field


class StressState(BaseModel):
    stress_score: float = 0.0
    """Which band the score is in: low | medium | high | max. The bar's depth
    and the label's colour both come from this, so the two can never disagree."""
    level: str = "low"
    breathing_used_today: bool = False


class StressIncreaseRequest(BaseModel):
    """Client-reported stress bump (rapid clicking). Server clamps the amount."""

    amount: float = Field(default=5.0, ge=0)


class BreathingResult(StressState):
    stress_reduced: bool = False
    message: str = ""


class DailyReport(BaseModel):
    """One day of work, rolled up. Written after the day ends; today's copy is
    computed live and marked `in_progress`."""

    date: str
    actions: dict[str, int] = {}
    total_actions: int = 0
    stress_added: float = 0.0
    peak_score: float = 0.0
    end_score: float = 0.0
    breathing_done: bool = False
    grind_actions: int = 0
    grind_from: str = ""
    in_progress: bool = False


class JournalPage(BaseModel):
    month: str
    entries: list[DailyReport] = []
