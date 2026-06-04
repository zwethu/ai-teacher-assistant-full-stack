from datetime import datetime

from pydantic import BaseModel


class EmailModel(BaseModel):
    id: str | None = None
    uid: str
    to: str
    subject: str
    body: str
    status: str = "pending"
    send_at: datetime | None = None
    sent_at: datetime | None = None


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str


class ScheduleEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    send_at: datetime
