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
    else:
        logging.getLogger(__name__).warning(
            "GCP credentials file not found (tried %s). GCS/Vertex uploads will fail.",
            raw,
        )


_configure_gcp_credentials()

logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.agent import router as agent_router
from routers.artifacts import router as artifacts_router
from routers.auth import router as auth_router
from routers.batches import router as batches_router
from routers.chats import router as chats_router
from routers.course_blueprint import router as course_blueprint_router
from routers.email import router as email_router
from routers.files import router as files_router
from services.maintenance_scheduler import shutdown_scheduler, start_scheduler

_frontend_url = (os.getenv("FRONTEND_URL") or "http://localhost:5173").rstrip("/")
_cors_origins = list(
    dict.fromkeys([_frontend_url, "http://localhost:5173"]),
)

app = FastAPI(title="AI Teacher Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="", tags=["auth"])
app.include_router(batches_router)
app.include_router(artifacts_router)
app.include_router(files_router)
app.include_router(chats_router)
app.include_router(course_blueprint_router)
app.include_router(email_router, prefix="", tags=["email"])
app.include_router(agent_router, prefix="/agent", tags=["agent"])


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
