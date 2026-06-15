from pydantic import BaseModel, Field


class StudentInput(BaseModel):
    name: str
    email: str


class BatchCreate(BaseModel):
    batch_name: str
    course_name: str
    academic_year: str
    term: str
    students: list[StudentInput] = Field(default_factory=list)


class BatchModel(BaseModel):
    batch_id: str
    batch_name: str
    course_name: str
    lecturer_id: str
    lecturer_email: str
    datastore_id: str = ""
    storage_prefix: str = ""
    academic_year: str = ""
    term: str = ""
    student_count: int = 0
    status: str = "active"
    created_at: str | None = None
    updated_at: str | None = None
