from pydantic import BaseModel


class User(BaseModel):
    uid: str
    email: str
    displayName: str | None = None
    credits: int = 0
    googleRefreshToken: str | None = None
