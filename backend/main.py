from dotenv import load_dotenv

load_dotenv()

import logging
import os

logging.basicConfig(level=logging.INFO)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.auth import router as auth_router
from routers.email import router as email_router
from services.email_scheduler import shutdown_scheduler, start_scheduler

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
app.include_router(email_router, prefix="", tags=["email"])


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
