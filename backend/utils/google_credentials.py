import os

from google_auth_oauthlib.flow import Flow

GOOGLE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",

    # Drive file access for app-created / app-used files
    "https://www.googleapis.com/auth/drive.file",

    # Lesson plan Google Docs
    "https://www.googleapis.com/auth/documents",

    # Google Forms creation + responses
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.responses.readonly",

    # Gmail: create drafts + send emails
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",

    # Calendar: read events + create/update schedules
    "https://www.googleapis.com/auth/calendar.events",
]

def _allow_local_http_oauth(redirect_uri: str) -> None:
    if redirect_uri.startswith("http://127.0.0.1") or redirect_uri.startswith(
        "http://localhost"
    ):
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"


def get_google_redirect_uri() -> str:
    explicit = (os.getenv("GOOGLE_REDIRECT_URI") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    return "http://localhost:8000/auth/google-scopes/callback"


def get_google_flow() -> Flow:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ValueError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set")

    redirect_uri = get_google_redirect_uri()
    _allow_local_http_oauth(redirect_uri)

    client_config = {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri],
        }
    }

    return Flow.from_client_config(
        client_config,
        scopes=GOOGLE_SCOPES,
        redirect_uri=redirect_uri,
    )
