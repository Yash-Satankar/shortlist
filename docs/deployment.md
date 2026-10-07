# Deploying on Railway

How the public instance runs. For your own server, [self-hosting](self-hosting.md) is simpler.

## Railway

One service runs everything: API, web app and background jobs (pg-boss, in the same process and database). The build is the `Dockerfile` (auto-detected). Deploy settings are **service settings in the
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
