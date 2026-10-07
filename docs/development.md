# Development

For working on Job Tracker itself. To run your own copy, see [self-hosting](self-hosting.md).

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
- **Auth.** Multi-user: every table has `user_id`, and every query is scoped by it (cross-user tests cover each feature). Sign-up follows `SIGNUP_MODE`. Passwords use argon2id. Session and
  API tokens are random and stored only as SHA-256 hashes. Cookie-authenticated writes must
  come from `APP_ORIGIN` (Origin / Sec-Fetch-Site check). The Chrome extension uses revocable
  bearer tokens (`/api/auth/tokens`), and those tokens cannot mint more tokens.
- **Encryption at rest.** AES-256-GCM for CTC figures, recruiter contacts, portal
  snapshots, stored emails, prep packs and AI keys: `*_enc` columns, transparently via Drizzle custom types. JDs, notes and Q&A answers stay
  plaintext so Postgres full-text search works; encrypted emails are searched by decrypting them in
  memory for one request (see [ADR 0006](adr/0006-search-without-vectors.md)). Keys are rotatable
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
| `GET /stats` | Inbox numbers (week = Monday 00:00, user timezone), replies this week, next follow-up, badge counts |
| `POST /applications/:id/ghost/dismiss` | "Not yet" on a ghost suggestion (until new activity or `GHOST_SUGGEST_DAYS`) |
| `GET /config` | Public: what signed-out screens need (`sessionTtlDays`, `signupMode`, `needsSetup`, `emailEnabled`, `demo`) |
| `GET /reviews` | Automatic changes waiting for review |
| `GET /companies?q=` | Company autocomplete |
| `POST /import/tracker-xlsx[?commit=true]` | Spreadsheet import (raw .xlsx body, session only). Dry run unless `commit=true` |
| `POST /auth/setup` · `/auth/signup` · `/auth/verify` · `/auth/password-reset/*` · `/auth/demo` | First-run setup, sign-up per `SIGNUP_MODE`, email confirmation, password reset, demo sign-in |
| `GET/PUT/DELETE /ai/keys/:provider` · `GET /ai` · `PATCH /ai/settings` · `GET /ai/usage` | BYOK keys (never returned), per-task models, monthly cap, usage |
| `POST /ask` · `GET/PATCH /ask/settings` | Ask my job search (exact database answers or cited answers); include-emails switch |
| `GET/POST /prep/:applicationId` | Interview prep pack: state + cost estimate / generate |
| `POST /drafts` | Follow-up draft (email, LinkedIn note, LinkedIn message); never sent |
| `GET /emails/status` · `POST /emails/check` · `GET /emails/unmatched` · `POST /emails/:id/assign\|dismiss` | Email updates |
| `GET /portal-sync/pending` · `POST /portal-sync/...` | Portal status sync proposals and review |
| `GET /account/export?format=json\|csv` · `POST /account/delete` | Your data (web session only) |
| `GET /admin/errors` · `GET/POST/DELETE /admin/invites` | Admins: recent errors, invite links |

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
