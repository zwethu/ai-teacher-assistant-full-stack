from pydantic import BaseModel


class UserModel(BaseModel):
    uid: str
    email: str
    display_name: str | None = None
    google_refresh_token: str | None = None
