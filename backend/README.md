# Unsent Backend

Local-first Fastify + SQLite API for the **Unsent** emotional-support app.
All user data stays on this server; the only thing that talks to the outside
world is the optional AI companion (OpenRouter or Groq, both free tiers).

- **Stack:** Node 20+, Fastify 5, `node:sqlite` (built-in, no native build),
  Zod for validation, `@clerk/fastify` for auth.
- **Auth:** Clerk. Runs in dev mode as a single `local_user` when no
  `CLERK_SECRET_KEY` is set.
- **DB:** single SQLite file at `data/unsent.db` (WAL mode).

## Quick start

```bash
pnpm install
cp .env.example .env       # then edit
pnpm dev                   # http://127.0.0.1:4000
```

Without any keys, the server boots in **dev mode** and every request runs
as `local_user`. You'll see a loud warning in the logs.

## Auth modes

| Mode    | Triggered by                      | `req.userId`        | `req.authMode` |
|---------|-----------------------------------|---------------------|----------------|
| dev     | `CLERK_SECRET_KEY` is empty       | `"local_user"`      | `"dev"`        |
| clerk   | `CLERK_SECRET_KEY=sk_test_...`    | Clerk `user_xxx` id | `"clerk"`      |

In Clerk mode every `/api/*` route (except `/api/health` and `/api/ai/status`)
requires a Clerk session token via:

```
Authorization: Bearer <sessionToken>
```

or the `__session` cookie that Clerk's front-end SDK sets automatically.

The token's `sub` claim (the Clerk user id) is used as the database primary
key for `settings.user_id` and is created on first authenticated request.

### Setting up Clerk

1. Create an app at https://dashboard.clerk.com.
2. Copy the **Secret key** into `.env`:
   ```
   CLERK_SECRET_KEY=sk_test_...
   CLERK_PUBLISHABLE_KEY=pk_test_...   # for the front-end
   ```
3. In the Clerk dashboard, add `http://127.0.0.1:4000` to allowed origins.
4. From your front-end, get a session token with
   `await window.Clerk.session?.getToken()` and send it as
   `Authorization: Bearer ***`.

## API

All authenticated routes return `req.userId` as a string — pass it back
in subsequent requests via your session.

| Method | Path                            | Notes                                     |
|--------|---------------------------------|-------------------------------------------|
| GET    | `/`                             | service info + endpoint list              |
| GET    | `/api/health`                   | liveness (public)                         |
| GET    | `/api/me`                       | current user + auth mode                  |
| GET    | `/api/home`                     | dashboard payload (vents, journal, mood)  |
| GET    | `/api/settings`                 | settings (no `app_lock_pin_hash`)         |
| PATCH  | `/api/settings`                 | partial update                            |
| GET    | `/api/avatar`                   | current avatar + available options        |
| PATCH  | `/api/avatar`                   | update; rejects `source: "realistic"`     |
| GET    | `/api/vents`                    | paginated, `?limit=&offset=`              |
| POST   | `/api/vents`                    | 3/day free tier, returns 402 if capped    |
| GET    | `/api/vents/:id`                |                                           |
| PATCH  | `/api/vents/:id`                | mark released / saved-as-journal          |
| DELETE | `/api/vents/:id`                |                                           |
| GET    | `/api/unsent`                   | filter `?shape=breakup` etc.              |
| POST   | `/api/unsent`                   |                                           |
| PATCH  | `/api/unsent/:id`               | rewrite / change outcome                  |
| DELETE | `/api/unsent/:id`               |                                           |
| GET    | `/api/journal`                  | paginated, `?kind=gratitude` etc.         |
| POST   | `/api/journal`                  |                                           |
| PATCH  | `/api/journal/:id`              |                                           |
| DELETE | `/api/journal/:id`              |                                           |
| GET    | `/api/mood`                     | recent check-ins                          |
| GET    | `/api/mood/today`               |                                           |
| GET    | `/api/mood/week`                | last 7 days                               |
| POST   | `/api/mood`                     |                                           |
| DELETE | `/api/mood/:id`                 |                                           |
| GET    | `/api/affirmations`             | `?mood=`, `?favorites=1`                  |
| POST   | `/api/affirmations/seed-presets`| inserts 15 preset lines (idempotent)      |
| POST   | `/api/affirmations`             |                                           |
| PATCH  | `/api/affirmations/:id`         | favorite / re-categorize                  |
| DELETE | `/api/affirmations/:id`         |                                           |
| GET    | `/api/intentions`               | `?kind=daily&active=1`                    |
| POST   | `/api/intentions`               |                                           |
| PATCH  | `/api/intentions/:id`           |                                           |
| DELETE | `/api/intentions/:id`           |                                           |
| GET    | `/api/coping`                   | last 100 sessions                         |
| POST   | `/api/coping`                   |                                           |
| GET    | `/api/export`                   | all data, JSON attachment, no PIN hash    |
| POST   | `/api/wipe`                     | body `{ "confirm": "DELETE" }`            |
| POST   | `/api/ai/companion`             | `{ text, mood?, history?, persist? }`     |
| POST   | `/api/ai/crisis-check`          | pre-check, returns 988-Lifeline etc.      |
| GET    | `/api/ai/status`                | which AI is wired                         |

## Errors

All errors come back as JSON with a stable shape:

```json
{ "error": "validation_failed", "details": { "fieldErrors": {...} } }
```

| `error`                 | Status | When                                            |
|-------------------------|--------|-------------------------------------------------|
| `unauthenticated`       | 401    | Clerk mode, no token                            |
| `invalid_token`         | 401    | Clerk mode, token rejected                      |
| `validation_failed`     | 400    | Zod schema failed                               |
| `not_found`             | 404    | id doesn't exist for this user                  |
| `free_tier_limit_reached` | 402  | 3rd vent of the day on free tier                |
| `forbidden_source`      | 400    | avatar `source` is `realistic`                  |
| `confirmation_required` | 400    | `/api/wipe` called without `confirm: "DELETE"`  |

## Data model

11 tables, all keyed on `user_id` (TEXT). See `src/db/schema.js` for the
full DDL. `app_lock_pin_hash` is the only sensitive field; it's stripped
from `/api/settings` and `/api/export` responses.

## Privacy

- No telemetry, no analytics rows.
- Voice data is never stored; `voice_save_enabled` is OFF by default and
  `cloud_transcription` is OFF by default.
- Crisis triggers are stored as a SHA-256 hash prefix (16 hex chars), not
  the full text.
- `app_lock_pin_hash` is excluded from every public response.

## License

Private. Do not redistribute the safety-flag data even if you fork.
