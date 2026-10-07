# The public demo

A separate deployment with fictional data that anyone can open with **Try the demo**. It never touches real data: it has its own database and secrets, it's read-only, and its AI features never call a provider (see [ADR 0010](adr/0010-read-only-demo.md)).

## Create it on Railway (one time)

1. **New environment.** In the project, open Environments → **New environment**, name it `demo`, and choose **Empty environment**. Don't duplicate production: that would copy its variables, including the encryption key.
2. **Services.** In `demo`, add **GitHub repo** (this repo, branch `main`) and **Database → PostgreSQL**.
3. **App variables** (app service → Variables):

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `SERVE_WEB` | `true` |
   | `TRUST_PROXY` | `2` |
   | `APP_ORIGIN` | `https://<the domain from step 5>` |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `ENCRYPTION_KEYS` | `demo:<a new key>` (generate one locally with `pnpm keygen`; never reuse production's) |
   | `ENCRYPTION_ACTIVE_KEY_ID` | `demo` |
   | `DEMO_MODE` | `true` |
   | `SIGNUP_MODE` | `closed` |

   Set nothing else: no AI keys, no IMAP, no SMTP.
4. **Deploy settings** (app service → Settings → Deploy):
   - Pre-deploy command: `node apps/api/dist/scripts/migrate.js && node apps/api/dist/scripts/demo-seed.js`
   - Healthcheck path: `/api/health`
5. **Domain.** Settings → Networking → **Generate domain** (or add a custom one), then put it in `APP_ORIGIN` and redeploy.

The seed refuses to run on a database holding any non-demo account, so pointing it at production by mistake fails safely. The fictional data is rebuilt every night (`DEMO_REFRESH_CRON`) so its dates stay current.

## Check it

- `https://<demo>/api/config` → `"demo": true`
- The page shows **Try the demo**, and inside, a "Demo · fictional data, read-only" bar.
- Changing a status shows "This is a read-only demo…".

## Run it locally

```bash
createdb jobtracker_demo   # or via docker exec … psql
DATABASE_URL=postgres://…/jobtracker_demo DEMO_MODE=true pnpm db:migrate
DATABASE_URL=postgres://…/jobtracker_demo DEMO_MODE=true pnpm --filter @jt/api demo:seed
```

Then start the server with the same two variables (plus `SERVE_WEB=true` after `pnpm build`).
