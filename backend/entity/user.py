from pydantic import BaseModel


class UserModel(BaseModel):
    uid: str
    email: str
    display_name: str | None = None
    credits: int = 0
    google_refresh_token: str | None = None
