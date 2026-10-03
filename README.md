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
```

`pnpm dev` binds Vite to your LAN too, so you can open `http://<your-pc-ip>:5173` on your phone.
(Set `APP_ORIGIN` to that URL while doing so, or writes will be rejected by the CSRF guard.)

### Common commands

| Command | What it does |
| --- | --- |
| `pnpm test` | All tests (API tests use `DATABASE_URL_TEST`; Postgres must be up) |
| `pnpm typecheck` | Type-check every package |
| `pnpm db:generate` | Generate a SQL migration after editing `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations (also runs automatically on server start) |
| `pnpm user:create -- --email a@b.com` | Create a user (prompts for password). Use this in production; `db:seed` is dev-only and refuses `NODE_ENV=production` |
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

## Deployment (Railway)

One service runs the API and the web app (and later a second service from the same repo for the
pg-boss worker). Build: `pnpm install --frozen-lockfile && pnpm build`. Start: `pnpm start`.
Env: everything in `.env.example`, plus `NODE_ENV=production`, `SERVE_WEB=true`, `TRUST_PROXY=1`,
and `APP_ORIGIN=https://<your-app>.up.railway.app`. Migrations run on boot; seeding never does.
Create your account once with `pnpm user:create` from a Railway shell.

## Roadmap

- [x] **Phase 1.1**: scaffold, schema + migrations, auth, seed, tests
- [ ] 1.2: applications API (CRUD, status events + undo, Q&A, answer library, duplicate check, search)
- [ ] 1.3: .xlsx importer (preview, idempotent; "My Standard Answers" → answer library)
- [ ] 1.4: web UI: list/kanban, detail + timeline, follow-ups, PWA + Web Share Target quick-add
  (share target must be `method: GET` with title/text/url params: a POST share would arrive
  without the SameSite=Lax session cookie and be blocked by the cross-origin write guard)
- [ ] Phase 2: Chrome extension · Phase 3: email intake · Phase 4: AI prep packs, follow-ups, chat
