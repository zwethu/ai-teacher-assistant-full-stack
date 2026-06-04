from datetime import datetime

from pydantic import BaseModel


class Email(BaseModel):
    id: str
    uid: str
    to: str
    subject: str
    body: str
    status: str
    sendAt: datetime | None = None
    sentAt: datetime | None = None
