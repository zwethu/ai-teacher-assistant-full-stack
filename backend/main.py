import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import agent, auth, google

load_dotenv()

app = FastAPI(
    title="AI Teaching Companion API",
    description=(
        "Minimal backend. React uses Firebase (auth, Firestore) and GCP Agent Engine "
        "for AI. This service only handles server-side secrets and jobs."
    ),
    version="0.1.0",
)

_cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Google OAuth (client secret must not live in the browser)
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# Optional Google Workspace proxy (Gmail / Calendar / Forms with stored refresh tokens)
app.include_router(google.router, prefix="/api/google", tags=["google"])

# Optional thin proxy to Agent Engine when the endpoint must not be called from the browser
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])


@app.on_event("startup")
async def on_startup() -> None:
    """Startup — e.g. start APScheduler for scheduled emails when implemented."""
    _ = os.getenv("APP_ENV", "development")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
