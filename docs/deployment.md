# Backend deployment runbook (Cloud Run)

The backend currently runs **only locally**. This is what has to happen to deploy it,
written down while the read-quota work was in flight because several items are
prerequisites for that work to behave correctly in production.

`backend/README.md`'s "Docker (Cloud Run)" section is two `docker` commands and is not
sufficient. Treat this file as the runbook.

---

## 1. Blockers in the repo — fix before the image will work

| # | Problem | Where |
|---|---|---|
| 1 | **`Dockerfile` never COPYs `entity/`**, but `pyproject.toml` declares it in `packages` and the code imports it. `pip install .` fails, or the container `ImportError`s at startup. | `backend/Dockerfile:11-13`, `backend/pyproject.toml:45` |
| 2 | **No `.dockerignore`**, while `gcp-service-account.json` and `serviceAccountKey.json` sit in `backend/`. Safe today only because the COPYs are explicit — add one before anyone writes `COPY . .`. | `backend/` |
| 3 | **`load_dotenv(..., override=True)`** means a `.env` baked into an image would beat Cloud Run's injected env vars. Inert today (not copied), which is exactly why it is easy to get wrong later. | `backend/main.py:5` |
| 4 | **`GET /health` does not exist** despite the README advertising it. The only health route is `GET /`. Point any HTTP probe at `/`. | `backend/main.py:88-90` |
| 5 | **CORS always allows `http://localhost:5173`**, with `allow_credentials=True`, even in production. | `backend/main.py:49-62` |
| 6 | `@app.on_event` is deprecated; migrate to a lifespan handler when touching startup. | `backend/main.py:78-85` |

## 2. Security gate — the one that bites

`verify_task_caller` **returns immediately when `CLOUD_TASKS_ENABLED != "true"`**
(`backend/routers/tasks.py:26-44`). Deploying with `--allow-unauthenticated` and
forgetting that one variable leaves **all task routes open to the internet**.

The failure is symmetric and silent in the other direction: with
`CLOUD_TASKS_ENABLED=true` but `SERVICE_URL` or `CLOUD_TASKS_SERVICE_ACCOUNT` unset,
`enqueue` logs an error and **drops the task** (`backend/services/cloud_tasks.py:89-94`).
Attachments would sit at `status: "processing"` forever and deferred runs would never
dispatch. Set all three together or none of them.

`SERVICE_URL` is both the enqueue target and the **OIDC audience**
(`cloud_tasks.py:110`, `tasks.py:35`), so it must exactly equal the deployed Cloud Run
URL with any trailing slash stripped.

## 3. Environment variables

`backend/.env` today is missing **all eight Cloud Tasks variables plus `SERVICE_URL`**.

New / required in production:

| Var | Value |
|---|---|
| `CLOUD_TASKS_ENABLED` | `true` — also turns APScheduler off and turns task auth on |
| `SERVICE_URL` | the Cloud Run URL; doubles as the OIDC audience |
| `CLOUD_TASKS_SERVICE_ACCOUNT` | the invoker service-account email |
| `GOOGLE_CLOUD_PROJECT` | project id |
| `CLOUD_TASKS_LOCATION` | defaults to `us-central1` |
| `CLOUD_TASKS_QUEUE_ATTACHMENTS` / `_RUNS` / `_INDEXING` | default `attachments` / `agent-runs` / `indexing`. **Module-level constants, read once at import** — changing them needs a restart |
| `MAINTENANCE_SCHEDULER_ENABLED` | leave unset in prod (defaults on, and is a no-op there since Cloud Tasks disables APScheduler) |

Carry over from the existing `.env`: `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`,
`FIREBASE_RTDB_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`FRONTEND_URL`, `VERTEX_ROOT_DATASTORE_ID`, `GCS_BUCKET_NAME`,
`AGENT_ENGINE_RESOURCE_NAME`, `AGENT_ENGINE_LOCATION`, `AGENT_APP_NAME`.

**Drop `GOOGLE_APPLICATION_CREDENTIALS`.** There is no key file on Cloud Run and the
Google libraries fall back to the metadata server. `main.py:11-31` will log a
misleading "credentials file not found" warning; it is harmless.
`utils/rtdb_client.py:50-53` already handles `ApplicationDefault()` correctly.

**Frontend:** `VITE_API_URL` is inlined by Vite at **build** time (it defaults to
`http://localhost:8000` in `lib/api.ts`, `AuthContext.tsx` and `authService.ts`), so the
frontend must be rebuilt once the backend URL exists.

## 4. Infrastructure to create

- **Cloud Tasks queues:** `attachments`, `agent-runs`, `indexing`.
- **Firestore indexes:** `firebase deploy --only firestore:indexes`. All collection-group
  queries in use are already covered by the `fieldOverrides` in
  `backend/firestore.indexes.json`.
- **RTDB rules:** `firebase deploy --only database`. Required — `database.rules.json` is
  root default-deny, and the `chatAttachments` rule is what lets the composer subscribe
  to attachment readiness instead of polling.
- **Cloud Scheduler jobs**, below.

## 5. Cloud Scheduler

`CLOUD_TASKS_ENABLED=true` turns the in-process APScheduler off
(`services/maintenance_scheduler.py:17-24`), so each remaining sweep needs a job.

| Target route | Cadence | Notes |
|---|---|---|
| `/tasks/cron/recover-files` | **15 min** | Not 2 min. `run_index_file_task` takes a 120-minute recovery lease, so a faster sweep re-reads the same files and enqueues tasks that immediately no-op |
| `/tasks/cron/attachment-watchdog` | **30 min**, or omit | Backstop only — every deferred run now schedules its own `/tasks/attachment-deadline` |
| `/tasks/cron/send-emails` | 5 min | See §7 |
| `/tasks/cron/cleanup-attachments` | hourly | unchanged |
| `/tasks/cron/sweep-workflow-chats` | daily | unchanged; dry-run unless `WORKFLOW_CHAT_SWEEP_ENFORCE` is truthy |
| `/tasks/cron/reconcile-attachments` | weekly | unchanged; dry-run unless `CHAT_ATTACHMENT_RECONCILE_ENFORCE=true` |

Cloud Scheduler's free allowance is a few jobs per billing account; beyond that it is
cents per job per month. If the count matters, collapse these behind a single
`/tasks/cron/maintenance` route that decides what is due.

## 6. Remaining scan → scheduled-task conversions

These were designed but **not implemented**, because `delay_seconds` locally falls back
to a `threading.Timer` that dies with the process
(`backend/services/cloud_tasks.py:81-82`) — they only become reliable once Cloud Tasks
is real. Both remove a periodic Firestore scan outright.

- **Overlay retirement.** `file_service.py:530` computes
  `overlay_retire_after = now + grace_hours`, and then we scan every sweep to discover a
  timestamp we ourselves just wrote. Enqueue the retirement task there with that exact
  `schedule_time` (Cloud Tasks allows up to 30 days). Removes the third of
  `recover_batch_files`' three queries.
- **Stuck-file detection.** At upload, enqueue one deadline check at `now + 2h`. If the
  file reached `indexed` it is one read and a no-op. O(1) per upload, and zero reads on
  days nobody uploads — versus a scan running regardless.

`enqueue` creates tasks **without a name**, so there is no dedup and no `delete_task`
handle. Every deadline handler must therefore re-read state and no-op, which is how
`release_run_past_deadline` is already written.

## 7. Scheduled email — documented, not converted

`check_and_send_emails` scans `emails` for `status == "pending" AND send_at <= now`. It
cannot become a scheduled task without also moving the write, because **the browser
writes the email document straight to Firestore** — `frontend/src/pages/Email.tsx:406-421`,
permitted by `docs/firestore.rules:93-98`, with no backend involvement. Cancel is
likewise a client-side `deleteDoc`; there is no backend cancel endpoint.

The conversion, when wanted: add `POST /emails/schedule`, point `Email.tsx` at it,
`enqueue(..., delay_seconds=int((send_at - now).total_seconds()))`, and remove client
`create`/`update` on `emails` in the rules. The task re-reads the doc and no-ops if it
is gone or no longer `pending`, which covers cancel and reschedule without named tasks.

Two pre-existing robustness gaps in that job, also unchanged: there is no `failed` status
and no attempt counter, so a permanently broken email is retried on every scan forever
(`email_scheduler.py:84-87`); and recipient fan-out is not idempotent, so a mid-list
failure re-sends to earlier recipients on the next scan (`:59-74`).

## 8. Post-deploy verification

1. Startup logs show `Cloud Tasks enabled — cron handled by Cloud Scheduler; APScheduler not started`.
2. An unauthenticated `POST /tasks/cron/recover-files` returns **401**.
3. Upload a course file and confirm it reaches `index_status: indexed` without the sweep
   having to rescue it.
4. Send a chat message with an attachment and confirm the run dispatches on settle, not
   on timeout.
5. Watch Firestore reads for 24h — GCP Console → Firestore → Usage, or alert on
   `firestore.googleapis.com/document/read_count`. The free tier is 50K reads/day.
