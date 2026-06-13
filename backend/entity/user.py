from pydantic import BaseModel


class UserModel(BaseModel):
    uid: str
    email: str
    display_name: str | None = None
    photo_url: str | None = None
    google_refresh_token: str | None = None
