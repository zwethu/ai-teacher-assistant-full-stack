# Backend — FastAPI on Cloud Run

This service is not a thin proxy. **It is the only thing in the system that persists
anything.** The agent runtime in `Pnai-ai/` generates content into ADK session state
and never writes it down; this backend reads that state and owns every write to
Firestore, every export to Google Docs / Forms / Gmail, and all Google OAuth.

The agent-side export/save tools are deliberately stubbed to raise `RuntimeError`. A
new persistence path belongs in `services/`, never in the agent.

| Concern | Where it lives |
|---|---|
| Google OAuth, refresh tokens, Firebase custom tokens | **here** (`routers/auth.py`) |
| Every Firestore write — batches, chats, artifacts, blueprints, games | **here** (`services/`) |
| Google Docs / Forms / Gmail export | **here** (`services/`) |
| Invoking Vertex AI Agent Engine, streaming to RTDB | **here** (`services/agent_gateway.py`) |
| Content generation | `Pnai-ai/` on Agent Engine |
| Rendering, run subscription, composer | `frontend/` (React) |

See `D:\PNAI\README.md` for the end-to-end picture and `AGENTS.md` for the exhaustive
endpoint and schema reference.

## Layout

```
backend/
├── main.py                    # app factory; 85 routes
├── routers/
│   ├── auth.py                # OAuth start / callback / session
│   ├── batches.py             # batches + students (CSV import lands here)
│   ├── chats.py               # messages, runs, pending-artifact terminals
│   ├── artifacts.py           # lesson plans / quizzes / labs
│   ├── course_blueprint.py    # course plan versions
│   ├── game.py, email.py, files.py, wellness.py, agent.py, google.py
│   └── tasks.py               # internal Cloud Task handlers (OIDC-secured in prod)
├── services/                  # all persistence + Google API work
│   ├── agent_gateway.py       # session-state seeding, agent invocation
│   ├── agent_sessions.py      # run lifecycle, once-only dispatch claim
│   ├── cloud_tasks.py         # enqueue; direct-call fallback locally
│   ├── maintenance_scheduler.py   # APScheduler crons
│   └── …_service.py
├── utils/
│   ├── firebase_auth.py       # verifies Firebase ID tokens on protected routes
│   ├── firestore_client.py, rtdb_client.py, gcs.py
└── tests/                     # 349 tests
```

## Async work

Attachment processing, agent invocation and Vertex Search indexing are enqueued as
**Cloud Tasks**, handled under `routers/tasks.py` (OIDC-secured in production, with a
direct-call fallback locally via `services/cloud_tasks.py`). Recurring jobs — email
send, attachment watchdog, cleanup — run through **APScheduler** in
`services/maintenance_scheduler.py`.

A run settles as one of `{done, failed, cancelled}`. Treat those as one set: dispatch
is protected by a once-only transactional claim (`claim_run_dispatch`), because each
deferred run schedules its own `run_id`-keyed timeout task that fires regardless of
state — the claim is the only thing stopping a late deadline task from restarting a
run the lecturer stopped.

## Local dev

```powershell
cd D:\PNAI\ai-teacher-assistant-full-stack\backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --reload
```

- Health check is **`GET /`** — there is no `/health`. OpenAPI at `/docs`.
- Use `python -m uvicorn`, **never** the bare `uvicorn` script: the space in the user
  profile path breaks the console-script trampoline on Windows.
- `.venv` is managed by **uv** (`uv sync`), not `venv`/`pip`. Do not run
  `py -m venv .venv` — it would clobber it, and `py` is broken on this machine anyway.
- `--reload` watches Python files, **not `.env`**. Restart fully after any `.env` change.

## Tests

```powershell
uv run --with pytest pytest tests/
```

`pytest` is not a project dependency, so `python -m pytest` fails with
`No module named pytest`. The `uv run --with` form sidesteps that without touching the
manifest. No `.env` preload is needed here (unlike the agent suite).

## Configuration

Set in `.env`; see the table in `D:\PNAI\README.md`. Two that are easy to mistake for
bugs:

- **`ATTACHMENT_VISION_MODEL` is unset by default**, so image attachments are stored
  but never analysed. An agent that "can't see" an uploaded image is usually this, not
  a bug.
- **`OVERLAY_RETIRE_GRACE_HOURS`** — pending course overlays keep their chunks this
  long before cleanup (default 24, clamped 1–168).

**Deploy `firestore.indexes.json` before enabling the maintenance scheduler.** Its
collection-group cleanup, file-recovery and attachment-reconcile queries need those
composite indexes; without them the crons throw `FAILED_PRECONDITION` at runtime, not
at startup.

Google OAuth is **intolerant of clock skew** — `verify_oauth2_token` is called without
`clock_skew_in_seconds`, so tolerance is exactly zero. A clock ~30s slow makes every
sign-in fail with `Token used too early`. Check the clock before debugging the OAuth code.

## Docker (Cloud Run)

```bash
docker build -t ai-teacher-assistant-api .
docker run -p 8080:8080 --env-file .env ai-teacher-assistant-api
```
