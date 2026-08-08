from dotenv import load_dotenv
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env", override=True)

import logging
import os


def _configure_gcp_credentials() -> None:
    """Resolve GCP credentials to an existing file under the backend directory."""
    raw = (os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "gcp-service-account.json").strip()
    path = Path(raw)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    if not path.is_file():
        fallback = BACKEND_DIR / "gcp-service-account.json"
        if fallback.is_file():
            path = fallback
    if path.is_file():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(path.resolve())
        logging.getLogger(__name__).info("Using GCP credentials: %s", path)
        return

    # No key file is the NORMAL state everywhere but legacy local setups: local
    # dev uses `gcloud auth application-default login` and Cloud Run uses the
    # runtime service account via the metadata server. This used to warn
    # "uploads will fail" unconditionally — on every boot of a correctly
    # configured process — so prove the claim before making it.
    try:
        import google.auth

        credentials, project = google.auth.default()
        identity = getattr(credentials, "service_account_email", None) or type(
            credentials
        ).__name__
        logging.getLogger(__name__).info(
            "No GCP key file; using Application Default Credentials (%s, project=%s)",
            identity,
            project,
        )
    except Exception as exc:
        logging.getLogger(__name__).warning(
            "No GCP credentials at all (no key file at %s, and ADC failed: %s). "
            "GCS/Vertex uploads WILL fail — run `gcloud auth application-default login` "
            "or attach a runtime service account.",
            raw,
            exc,
        )


_configure_gcp_credentials()

logging.basicConfig(level=logging.INFO)

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from utils.deps import require_lecturer

from routers.agent import router as agent_router
from routers.artifacts import router as artifacts_router
from routers.auth import router as auth_router
from routers.batches import router as batches_router
from routers.chats import router as chats_router
from routers.course_blueprint import router as course_blueprint_router
from routers.email import router as email_router
from routers.files import router as files_router
from routers.game import router as game_router
from services.maintenance_scheduler import shutdown_scheduler, start_scheduler

# Comma-separated list of allowed browser origins. Local dev works with the
# default; production sets CORS_ALLOWED_ORIGINS=https://milamfu.com,https://www.milamfu.com
_cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

app = FastAPI(title="AI Teacher Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Everything the browser calls is teacher-side work: the student game reads and
# writes Firestore directly and never touches this API. So the lecturer check
# goes on the INCLUDE rather than on each endpoint — a route added tomorrow is
# then protected by default instead of protected if someone remembers to.
#
# `auth` is excluded because it is how you get a role in the first place, and
# `tasks` because its callers are Cloud Tasks/Scheduler, which carry an OIDC
# token and no user at all (it verifies that itself).
_lecturer_only = [Depends(require_lecturer)]

app.include_router(auth_router, prefix="", tags=["auth"])
app.include_router(batches_router, dependencies=_lecturer_only)
app.include_router(artifacts_router, dependencies=_lecturer_only)
app.include_router(files_router, dependencies=_lecturer_only)
app.include_router(chats_router, dependencies=_lecturer_only)
app.include_router(course_blueprint_router, dependencies=_lecturer_only)
app.include_router(game_router, dependencies=_lecturer_only)
app.include_router(email_router, prefix="", tags=["email"], dependencies=_lecturer_only)
app.include_router(agent_router, prefix="/agent", tags=["agent"], dependencies=_lecturer_only)

from routers.tasks import router as tasks_router  # noqa: E402
app.include_router(tasks_router)


@app.on_event("startup")
async def on_startup() -> None:
    start_scheduler()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    shutdown_scheduler()


@app.get("/")
async def root() -> dict[str, str]:
    return {"status": "ok", "service": "AI Teacher Assistant API"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
