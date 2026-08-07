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

    # No calendar.events: scheduling is not implemented. calendar_service.py is
    # a placeholder nothing imports, so requesting the scope asked lecturers to
    # grant calendar access the app never used. Re-add it with the feature.
]

# The authorization request uses include_granted_scopes=true (incremental
# authorization), so Google returns every scope the lecturer has ever granted
# this client — not just the ones we asked for this time. oauthlib treats any
# difference between requested and returned scopes as an error and raises out
# of flow.fetch_token(), which the callback catches and turns into a redirect
# back to /login, i.e. sign-in silently fails.
#
# That is exactly what happens to anyone who granted calendar.events before it
# was dropped from GOOGLE_SCOPES: their grant still carries it, ours no longer
# asks for it, and the mismatch breaks the exchange. Relaxing the check is the
# documented way to use incremental authorization — the scope set legitimately
# differs by design, and the scopes we actually rely on are verified when each
# API client is built (see google_workspace/credentials.py).
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")


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
    # Strip whitespace and any UTF-8 BOM (U+FEFF): a BOM pasted into an env
    # file ends up in the Basic-auth header of the token exchange, where
    # requests' latin-1 encoding raises and sign-in silently bounces back
    # to /login.
    client_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip().lstrip("\ufeff").strip()
    client_secret = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip().lstrip("\ufeff").strip()
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
