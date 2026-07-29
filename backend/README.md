# Backend (thin layer)

Most of the app runs in the **React** client:

| Concern | Where it lives |
|--------|----------------|
| Auth, Firestore, storage | Firebase SDK in `frontend/` |
| Lesson plans, assessments, batches, wellness, etc. | Firestore + React pages |
| AI (lesson plan, assessment agents) | **GCP Agent Engine** — called from React |

This FastAPI service is only for what **cannot** run in the browser:

1. **Google OAuth** — exchange auth codes; keep `GOOGLE_CLIENT_SECRET` off the client
2. **Google Workspace APIs** (optional) — Gmail, Calendar, Forms using stored refresh tokens
3. **Scheduled emails** (optional) — APScheduler cron when you add `services/email_scheduler.py`
4. **Agent proxy** (optional) — forward requests to Agent Engine if you must not expose an endpoint or API key to the client

Chat attachment image analysis is opt-in. Set `ATTACHMENT_VISION_MODEL` to a
Vertex Gemini model name to enable summary/OCR processing. Native multimodal
Agent Engine input is intentionally disabled for this release; keep
`ENABLE_NATIVE_MULTIMODAL_ATTACHMENTS=false`.

Pending course overlays retain chunks for `OVERLAY_RETIRE_GRACE_HOURS` (default
24, clamped to 1–168). Deploy `firestore.indexes.json` before enabling the
maintenance scheduler's collection-group cleanup and file recovery queries.

## Layout

```
backend/
├── main.py
├── routers/
│   ├── auth.py      # OAuth start / callback / session
│   ├── google.py    # Workspace API proxy (placeholder)
│   └── agent.py       # Agent Engine proxy (placeholder)
├── services/
│   └── email_scheduler.py
└── utils/
    ├── firebase_auth.py   # Verify Firebase ID tokens on protected routes
    └── deps.py            # FastAPI dependencies (get_current_user)
```

## Local dev

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e .
copy .env.example .env
uvicorn main:app --reload --port 8000
```

`GET /health` · OpenAPI: `/docs`

## Docker (Cloud Run)

```bash
docker build -t ai-teacher-assistant-api .
docker run -p 8080:8080 --env-file .env ai-teacher-assistant-api
```
