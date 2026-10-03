# Job Tracker

Personal job-application tracker: applications, JD snapshots, status timeline, screening answers,
follow-ups. Later phases add a Chrome extension, email-based status updates and AI prep packs.

## Stack

| Part | Tech |
| --- | --- |
| API | Node 22+, Express 5, TypeScript, Drizzle ORM, PostgreSQL 17 (pgvector image) |
| Web | React 19, Vite, Tailwind 4, TanStack Query |
| Shared | `packages/shared`: enums, normalizers, Zod schemas used by API, web and extension |
| Tests | Vitest (+ Supertest against a real test database) |

```
apps/api        Express API, schema + migrations (apps/api/drizzle), scripts
apps/web        React app (served by the API in production → single origin)
packages/shared Code shared across apps
docker/         Postgres init (creates the test database)
```

## Local setup

Prerequisites: Node 22+, pnpm 10 (`npm i -g pnpm`), Docker Desktop.

```bash
pnpm install
cp .env.example .env          # then fill in:
pnpm keygen                   # → paste as ENCRYPTION_KEYS=k1:<key>
                              # set SEED_USER_EMAIL / SEED_USER_PASSWORD
pnpm db:up                    # Postgres on localhost:5433 (+ jobtracker_test db)
pnpm db:seed                  # runs migrations, creates your account
pnpm db:seed -- --demo        # optional: 5 fictional demo applications (tagged is_demo)
pnpm db:seed -- --remove-demo # delete only the demo rows
pnpm dev                      # API :3000 + web :5173 → open http://localhost:5173
pnpm import:xlsx -- --file ../../Job_Applications_Tracker.xlsx   # dry run; add --commit
```

`pnpm dev` binds Vite to your LAN too, so you can open `http://<your-pc-ip>:5173` on your phone.
(Set `APP_ORIGIN` to that URL while doing so, or writes will be rejected by the CSRF guard.)

### Common commands

| Command | What it does |
| --- | --- |
| `pnpm test` | All tests (API tests use `DATABASE_URL_TEST`; Postgres must be up) |
| `pnpm typecheck` | Type-check every package |
| `pnpm db:generate` | Generate a SQL migration after editing `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations (`pnpm dev` runs this first; production runs it as the pre-deploy step) |
| `pnpm user:create -- --email a@b.com` | Create a user (prompts for password). Use this in production; `db:seed` is dev-only and refuses `NODE_ENV=production` |
| `pnpm import:xlsx -- --file <path.xlsx> [--commit]` | Import the tracker spreadsheet. Dry run by default (counts + problem rows); `--commit` writes. Safe to re-run |
| `pnpm user:password -- --email a@b.com` | Set a new password and sign out all sessions (in the app: `POST /api/auth/password`) |
| `pnpm build && pnpm start` | Production build; Express serves the web app (`SERVE_WEB=true`) |

## Design notes

- **Single origin.** In production Express serves `apps/web/dist`, so the session cookie is
  first-party (`__Host-jt_sid`, `HttpOnly`, `Secure`, `SameSite=Lax`). In dev, Vite proxies
  `/api` to Express for the same effect. There are no cross-site cookies anywhere.
- **Auth.** Single user today; every table has `user_id`. Passwords use argon2id. Session and
  API tokens are random and stored only as SHA-256 hashes. Cookie-authenticated writes must
  come from `APP_ORIGIN` (Origin / Sec-Fetch-Site check). The Chrome extension uses revocable
  bearer tokens (`/api/auth/tokens`), and those tokens cannot mint more tokens.
- **Encryption at rest.** AES-256-GCM for CTC figures, recruiter contacts and (later) portal
  snapshots: `*_enc` columns, transparently via Drizzle custom types. JDs, Q&A answers and email
  bodies stay plaintext so Postgres full-text search works. Keys are rotatable
  (`ENCRYPTION_KEYS=k1:…,k2:…`, `ENCRYPTION_ACTIVE_KEY_ID=k2`).
- **Status timeline.** `status_events` is append-only, and every change records its source
  (manual / import / share / extension / portal / email / system). Undo appends a reverting
  event; nothing is deleted.
- **Config.** Everything tunable is an env var, validated at boot in
  `apps/api/src/config/env.ts`. See `.env.example`.

## API overview

All under `/api`, JSON, authenticated by session cookie (web) or `Authorization: Bearer jt_…` (extension).

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/login` · `/auth/logout` · `GET /auth/me` · `POST /auth/password` | Session auth |
| `GET/POST /auth/tokens` · `DELETE /auth/tokens/:id` | Extension API tokens (session only) |
| `GET /applications` | List: `status`, `source`, `workMode` (comma lists), `city`, `q` (full-text over role, notes, JDs, Q&A + company), `appliedFrom/To`, `archived`, `sort`, `limit/offset` |
| `POST /applications` | Create (+ optional `jd`, `answers`). 409 `duplicate_exact` (same posting) or `duplicate_likely` (resend with `confirmDuplicate: true`); same-company/other-role matches come back as `hints` |
| `POST /applications/check-duplicates` | Preview duplicate matches without saving |
| `GET/PATCH/DELETE /applications/:id` | Detail (company, latest JD + history, timeline, Q&A, contacts) / update / delete (`archived: true` to archive) |
| `POST /applications/:id/status` | Propose a status change; the response has the rule `decision` |
| `POST /applications/:id/events/:eventId/undo` | Undo the latest effective change (undo again = redo) |
| `POST /applications/:id/events/:eventId/review` | `accept` / `dismiss` a flagged automatic change |
| `PATCH /applications/:id/events/:eventId` | Edit a timeline entry's note / date |
| `POST /applications/:id/jd` · `GET /applications/:id/jd/:jdId` | Add / read JD snapshots (deduped by content) |
| `PUT /applications/:id/answers` | Replace the Q&A submitted for this application |
| `POST /applications/:id/contacts` · `PATCH/DELETE /contacts/:id` | Recruiter contacts (encrypted) |
| `GET/POST /answer-library` · `PATCH/DELETE /answer-library/:id` | Standard answers. GET merges read-only entries generated from the profile (`origin: "profile"`); questions owned by the profile return 409 `profile_field` |
| `GET/PATCH /profile` | Profile: the single source of truth for experience, notice period, relocation, location, CTC (encrypted) and resume text |
| `GET /follow-ups` | Due follow-ups, no-response items, ghost suggestions (never auto-applied) |
| `GET /reviews` | Automatic changes waiting for review |
| `GET /companies?q=` | Company autocomplete |
| `POST /import/tracker-xlsx[?commit=true]` | Spreadsheet import (raw .xlsx body, session only). Dry run unless `commit=true` |

### Status rules (`packages/shared/src/status.ts`)

- Manual, import, share-sheet and explicit extension clicks (`X-JT-Intent: user`) always apply.
  Extension auto-detection must send `X-JT-Intent: auto` and gets the automatic rules.
- Automatic sources (extension, portal sync, email, system) only move **forward** in
  Saved → Applied → Viewed → Assessment → Shortlisted → Interview. Backward signals are recorded
  as `ignored` (e.g. a late "Applied" email after Interview).
- Into **Rejected**: applied only for a high-confidence signal (still undoable); low → review.
- Into **Offer**: always reviewed (scam risk).
- **Offer, Rejected and Withdrawn are locked**: automatic signals are only flagged
  (`pending_review`). Ghosted and Withdrawn are never set automatically.
- A real signal (Viewed or later) reopens a Ghosted application.
- Every proposal lands on the timeline with its source, disposition and reason.

## Deployment (Railway)

One service runs everything (API + web app; background jobs will run in-process when the first one
lands). The build is the `Dockerfile` (auto-detected). Deploy settings are **service settings in the
Railway dashboard** (job-tracker → Settings → Deploy). Railway ignores `railway.json` deploy keys for
services created after its Config-as-Code deprecation, so they are not kept in the repo:

| Stage | What runs | On failure |
| --- | --- | --- |
| Build | `Dockerfile`: install, `pnpm build`, reinstall production deps only | build fails |
| Pre-deploy | `node apps/api/dist/scripts/migrate.js`: checks `pg_trgm` is available, applies migrations. **Never seeds.** | deploy fails, old version keeps running |
| Start | `node apps/api/dist/server.js` (does not migrate) | restarted (5 retries) |
| Health | `GET /api/health` (queries the DB) | deploy not promoted |

Dashboard deploy settings: **Pre-deploy command** `node apps/api/dist/scripts/migrate.js`,
**Healthcheck path** `/api/health` (timeout 60 s), restart policy *On failure*. The start command is
the Dockerfile's `CMD`. Note: Railway's **Redeploy** reuses the previous deployment's settings snapshot;
after changing service settings, ship a new deployment (git push) for them to apply.

Service variables: `NODE_ENV=production`, `TRUST_PROXY=2` (Railway's edge adds a hop; verify with
`GET /api/health/request`), `SERVE_WEB=true`,
`APP_ORIGIN=https://<domain>`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, a **production-only**
`ENCRYPTION_KEYS` / `ENCRYPTION_ACTIVE_KEY_ID`, plus any tunables from `.env.example`.
Postgres: Railway's standard image works (only `pg_trgm` is needed; pgvector is not used yet).

First-time data (never copies the dev DB): create the account with `create-user.js` against the
production DB, then import the spreadsheet through the app's API (dry run first, then `?commit=true`).

Rehearse locally: `docker build -t jobtracker:local .`, then run the pre-deploy and start commands
against a scratch database.

### Backups

Prefer Railway's own Postgres backups (service → Backups) if your plan includes them. Otherwise
`.github/workflows/backup.yml` runs a nightly encrypted `pg_dump` to a private workflow artifact
once the repo secrets `PROD_DATABASE_URL` and `BACKUP_PASSPHRASE` are set. Restore:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in jobtracker-<stamp>.pgc.enc -out dump.pgc
pg_restore --clean --if-exists --no-owner -d "$TARGET_DATABASE_URL" dump.pgc
```

## Roadmap

- [x] **Phase 1.1**: scaffold, schema + migrations, auth, seed, tests
- [x] 1.2: applications API (CRUD, status events + undo + review, Q&A, answer library, duplicate check, search, follow-ups)
- [x] 1.3: .xlsx importer (dry-run preview, idempotent via import_key; "My Standard Answers" → answer library,
  CTC → encrypted profile)
- [x] 1.4: mobile-first web UI: list, follow-ups inbox (reviews, follow-ups, ghost suggestions), detail
  (timeline with undo/review, JD, Q&A, details), quick-add, installable PWA with a GET Web Share Target
  (`/share?title&text&url`), resume upload (PDF/DOCX → editable text), settings, kanban (drag = manual
  status change, undoable)
- [ ] Phase 2: Chrome extension · Phase 3: email intake · Phase 4: AI prep packs, follow-ups, chat
