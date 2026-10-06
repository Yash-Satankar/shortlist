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
| `GET /stats` | Inbox numbers (week = Monday 00:00, user timezone), replies this week, next follow-up, badge counts |
| `POST /applications/:id/ghost/dismiss` | "Not yet" on a ghost suggestion (until new activity or `GHOST_SUGGEST_DAYS`) |
| `GET /config` | Public: `sessionTtlDays` for the login screen |
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

Daily backups are Railway's own Postgres backups (Postgres service → Backups tab). Postgres has
no public endpoint; only the app reaches it over Railway's private network.

## Optional features

Every optional feature can be switched off, in two layers (`packages/shared/src/features.ts`):

- **Instance** (env `FEATURE_*`, see `.env.example`): what this deployment offers. At startup the API
  logs each feature as on, or off with the reason.
- **User** (Settings → Features, stored in `users.settings.features`): each user can switch features
  off for themselves. They can't switch on anything the instance doesn't offer.

Dependencies apply automatically: prep, chat and follow-up drafts need AI, and portal sync needs
the extension. AI also needs an API key the user may use (BYOK). Everything goes through one
helper, `featureState`/`isEnabled`:

- the API answers `403 feature_disabled` with the reason;
- background jobs skip;
- the web app and extension hide the surface.

API tokens exist only for the extension. With the extension off, token requests are refused,
except self-revoke, so Disconnect still works.

## Chrome extension (Job Status Tracker)

`apps/extension` is an MV3 extension, named in one place (`packages/shared/src/brand.ts`).

```bash
pnpm dev:extension     # watch build → apps/extension/dist (points at http://localhost:5173)
pnpm build:extension   # production build (points at the Railway URL; no dev-only features)
```

Load `apps/extension/dist` via `chrome://extensions` → Developer mode → Load unpacked. Pair it in
the web app under Settings → Browser extension → Pair a browser, then paste the code into the popup.

**Reading pages: how and when** (full detail in [PRIVACY.md](PRIVACY.md)):

- Job sites are *optional* host permissions, defined once in `apps/extension/src/lib/sites.ts`.
  Every site is **off by default**.
- A site's switch in the popup *is* Chrome's permission for that site. Turning it on asks Chrome for
  that site only, and the background worker then registers the reader for it
  (`chrome.scripting.registerContentScripts`) so pages are read when they load. Turning it off
  unregisters the reader and removes the permission. A grant or removal made in
  `chrome://extensions` is picked up as well.
- **Sync this page** is always available. It uses `activeTab`, so it reads the current tab once
  after your click and needs no stored permission.
- Readers look at the rendered DOM only: no auto-scrolling, pagination or extra requests. A read
  stays in session storage for its tab. Nothing is saved or applied without your confirmation.
- **Adapters** (`apps/extension/src/adapters`) read one job from the rendered page. There is one
  per site, and a generic reader handles unknown sites. Fields come, in order, from:
  1. the site's DOM, using layered selectors that prefer stable hooks (`data-automation-id`,
     `data-qa`, partial class names, the tab title);
  2. schema.org `JobPosting` JSON-LD;
  3. meta tags;
  4. a main-content heuristic for the description.

  Each field records where it came from, and missing required fields are listed so the save
  form can ask for them. Fixtures and their expected output are in
  `apps/extension/test/fixtures` (see its README).
- **Fixture capture** (dev builds only, never in production or the Web Store) saves the current
  page as a sanitized fixture into `Downloads/jst-captures/`. Captures are reviewed by hand
  before they're committed. *Known dev-tool limitation:* on some setups the file never arrives.
  Use Chrome's "Save page as… → Webpage, Complete" and `pnpm --filter @jt/extension
  sanitize:capture` instead (see `apps/extension/test/fixtures/README.md`).
- Content scripts are built as self-contained IIFE files (`content/reader.js`, `content/auto.js`)
  and run in the extension's isolated world, so the page's own scripts can't see them.
- **Job descriptions** come from structured data first (JSON-LD, then schema.org microdata),
  then the site adapter, then a content scorer. The scorer excludes consent banners, dialogs,
  overlays and page chrome. A description must pass a quality gate before the popup says
  "Job description added": at least `VITE_JD_MIN_CHARS` characters (default 600), not
  dominated by cookie/privacy text, and with job-description signals when it was found by page
  shape alone. Late-rendered pages are re-checked for up to `VITE_JD_SETTLE_MAX_MS` (default 4 s).

### Distribution (unlisted Chrome Web Store listing)

- **Release zip:** `pnpm --filter @jt/extension release` builds production and writes
  `apps/extension/release/job-status-tracker-<version>.zip`. It refuses to pack a dev build.
  CI builds the same zip on every push and uploads it as the `job-status-tracker-extension`
  artifact, after `check:prod` proves no dev-only switch or code is in the build.
- **Listing:** texts, permission justifications and data-use answers are in
  `apps/extension/store/listing.md`; screenshots (1280×800) and the promo tile (440×280) are in
  `apps/extension/store/`.
- **Privacy policy:** served from the app at `/privacy`, rendered from `PRIVACY.md`.
- **Publishing, once:**
  1. In the Developer Dashboard, create the item and upload the zip.
  2. Paste the listing texts and set visibility to **Unlisted**.
  3. Give reviewers a test account in "Test instructions", then submit.
- **Updates:** bump `apps/extension/package.json` `version`, then upload the new zip.

### "Application submitted" detection

The extension only detects submissions on sites you switched on. Each detector requires the
platform's own confirmation marker, never generic "thank you" text:

| Site | Marker |
| --- | --- |
| LinkedIn | post-apply dialog ("Application sent"), or the job's "Applied … ago" state |
| Greenhouse | `…/jobs/<id>/confirmation` page, or the legacy `#application_confirmation` |
| Lever | `…/<posting>/thanks` page |
| Naukri | the "Applied" state of the apply button |
| Workday | Workday's post-submit dialog/page hooks |

- **Verified detector** (it passes tests on a real captured page): the job is marked Applied
  with high confidence (`DETECTION_VERIFIED_CONFIDENCE`, 0.95), shown on the timeline, and an
  in-page notice offers **Undo**.
- **Unverified detector:** low confidence (`DETECTION_UNVERIFIED_CONFIDENCE`, 0.4). The
  submission waits in Follow-ups for you to confirm, and the status doesn't change.
- **Idempotent:** a reload or revisit records nothing new. A local "seen" record skips the
  call, and the server's per-job evidence key prevents a second event.
- **New jobs:** a job you don't track yet is saved from a *fresh* confirmation only. A standing
  "Applied … ago" never creates jobs while you browse. Matching by company and role (a
  different link) always asks.

**Adapter verification status** (`apps/extension/src/adapters/verification.ts`). A capability, or
for "submitted" each confirmation marker, is marked verified only together with a real captured
fixture that proves it, and a test enforces this.

| Site | Job page | Applications list |
| --- | --- | --- |
| LinkedIn | built, unverified (classic + newer layout; the real capture is a submitted page) | built, unverified (My Jobs → Applied) |
| Naukri | built, unverified | built, unverified (My Applies) |
| Greenhouse | built, unverified | — |
| Lever | built, unverified | — |
| Workday | built, unverified | — (deferred) |

Unverified readers are defensive. An applications-list row is read only when its job link, title,
company and status are all found where the reader expects them. Incomplete rows are dropped and
counted, never guessed. An unrecognised page reads nothing, and the popup says "Couldn't read this
page". Portal sync from any reader only ever creates proposals for you to review.

| "Submitted" marker | Verified |
| --- | --- |
| LinkedIn: "Application status · Application submitted" card (newer layout) | **yes** (real capture) |
| LinkedIn: Easy Apply "Application sent" dialog | not yet |
| LinkedIn: "Applied … ago" state (classic layout) | not yet |
| Greenhouse: confirmation page / legacy confirmation section | not yet |
| Lever: thanks page | not yet |
| Naukri: "Applied" button state | not yet |
| Workday: post-submit dialog | not yet |

## Roadmap

- [x] **Phase 1.1**: scaffold, schema + migrations, auth, seed, tests
- [x] 1.2: applications API (CRUD, status events + undo + review, Q&A, answer library, duplicate check, search, follow-ups)
- [x] 1.3: .xlsx importer (dry-run preview, idempotent via import_key; "My Standard Answers" → answer library,
  CTC → encrypted profile)
- [x] 1.4: mobile-first web UI: list, follow-ups inbox (reviews, follow-ups, ghost suggestions), detail
  (timeline with undo/review, JD, Q&A, details), quick-add, installable PWA with a GET Web Share Target
  (`/share?title&text&url`), resume upload (PDF/DOCX → editable text), settings, kanban (drag = manual
  status change, undoable)
- [x] UI data audit: confidence scores, server-side ghost "Not yet", inbox stats / next follow-up /
  badge counts from `/api/stats`, resume file metadata, relocation + expected CTC as structured fields
- [ ] Scale: the Applications list loads ≤ 500 rows and filters + counts facets on the client
  (`TODO(scale)` in `ApplicationsPage.tsx`). Move filters/facets server-side and page the list
  before anyone tracks more than ~500 applications.
- [ ] Phase 2: Chrome extension · Phase 3: email intake · Phase 4: AI prep packs, follow-ups, chat
