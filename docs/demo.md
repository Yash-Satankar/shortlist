# The public demo

A separate deployment with fictional data that anyone can open with **Try the demo**. It never touches real data: it has its own database and secrets, it's read-only, and its AI features never call a provider (see [ADR 0010](adr/0010-read-only-demo.md)).

It runs for free: the app on a **Render** free web service, the database on **Neon**'s free Postgres. A free Render service sleeps after about 15 minutes without visits, and waking it takes up to a minute. The website's [demo link](https://yash-satankar.github.io/shortlist/demo.html) shows "Waking up the demo…" and opens it when it's ready, and the app itself keeps retrying with a "Waking up the server" message instead of an error.

## 1. Neon: the database

1. Sign up at [neon.tech](https://neon.tech) (free plan) and create a project: name `shortlist-demo`, Postgres 17, region **AWS Asia Pacific (Singapore)** (next to the Render region below).
2. On the project dashboard, open **Connect**. Choose the default branch and database, turn **Connection pooling off** (the app's job queue needs a direct connection), and copy the connection string. It looks like `postgresql://neondb_owner:…@ep-….ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.

That's all on Neon. The app creates its tables on first start, and Neon suspends the database when idle (the first request after a while takes a second or two longer).

## 2. Render: the app

1. Sign up at [render.com](https://render.com) with GitHub, and allow it access to the `shortlist` repository.
2. **New → Web Service** → pick the `shortlist` repo. Then:
   - **Name:** `shortlist-app-demo` (the public demo runs at `https://shortlist-app-demo.onrender.com`; with another name, use the address Render shows you everywhere below)
   - **Region:** Singapore · **Branch:** `main` · **Language/Runtime:** Docker (detected from the Dockerfile)
   - **Instance type:** Free
3. **Advanced → Docker Command:**
   ```
   node apps/api/dist/scripts/start.js
   ```
   Exactly that, with no `sh -c` or quotes (Render runs the field as a plain command). Free instances have no pre-deploy step, so `start.js` migrates, rebuilds the fictional data (because `DEMO_MODE=true`) and then starts the server, on every start; this also keeps the demo's dates current.
4. **Advanced → Health Check Path:** `/api/health`
5. **Environment variables:**

   | Key | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `SERVE_WEB` | `true` |
   | `DEMO_MODE` | `true` |
   | `SIGNUP_MODE` | `closed` |
   | `TRUST_PROXY` | `3` (requests pass Cloudflare, then Render's balancer) |
   | `FEATURE_EMAIL_INTAKE` | `false` |
   | `DATABASE_POOL_MAX` | `5` |
   | `APP_ORIGIN` | `https://shortlist-app-demo.onrender.com` |
   | `DATABASE_URL` | the Neon connection string from step 1 |
   | `ENCRYPTION_KEYS` | `demo:<a new key>`; generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never reuse another instance's key. |
   | `ENCRYPTION_ACTIVE_KEY_ID` | `demo` |

   Set nothing else: no AI keys, no IMAP, no SMTP.
6. **Create Web Service.** The first build takes a few minutes.

The repo also has a `render.yaml` Blueprint with the same settings (**New → Blueprint**), if you prefer that to clicking through.

The seed refuses to run on a database holding any non-demo account, so pointing the demo at a real database by mistake fails safely.

## 3. Check it

- `https://shortlist-app-demo.onrender.com/api/config` → `"demo": true`
- `https://shortlist-app-demo.onrender.com/api/health/request` → `"protocol": "https"`, and `ip` is your own public IP (if it shows a `10.x` or Cloudflare address, adjust `TRUST_PROXY`)
- The page shows **Try the demo**, and inside, a "Demo · fictional data, read-only" bar.
- Changing a status shows "This is a read-only demo…".
- After 15+ minutes without visits, the website's demo link shows "Waking up the demo…" and then opens it.

If you use a different address, set it in `site/config.json` (`demoUrl`) so the website's demo link points at it.

## Run it locally

```bash
createdb jobtracker_demo   # or via docker exec … psql
DATABASE_URL=postgres://…/jobtracker_demo DEMO_MODE=true pnpm db:migrate
DATABASE_URL=postgres://…/jobtracker_demo DEMO_MODE=true pnpm --filter @jt/api demo:seed
```

Then start the server with the same two variables (plus `SERVE_WEB=true` after `pnpm build`).
