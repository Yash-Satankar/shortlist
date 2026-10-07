# Self-hosting

Run your own ShortList: your data stays on your server, and you bring your own AI keys (or none).

## What you need

- A machine with Docker and Docker Compose (any small VPS, a home server, or your laptop).
- A domain or subdomain with HTTPS in front of the app (Caddy, nginx, Traefik or a tunnel). Sign-in cookies are `Secure`, so outside `localhost` the app must be served over HTTPS.

## Start it

```bash
git clone https://github.com/Yash-Satankar/shortlist.git
cd shortlist
cp .env.example .env
```

Edit `.env`. These are the only required values:

| Variable | Set it to |
| --- | --- |
| `ENCRYPTION_KEYS` | `k1:<key>`, with a key from `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Back it up**: without it, encrypted fields (CTC, contacts, emails, AI keys) can't be read. |
| `ENCRYPTION_ACTIVE_KEY_ID` | `k1` |
| `APP_ORIGIN` | The public address, e.g. `https://jobs.example.com` (or `http://localhost:3000` to try it locally) |
| `TRUST_PROXY` | `1` behind one reverse proxy, `0` if nothing is in front |

Optionally change `POSTGRES_PASSWORD` (it's only reachable from the app container and `127.0.0.1`).

```bash
docker compose --profile app up -d
```

This starts Postgres and the app on port 3000 (`APP_PORT` to change it). Migrations run automatically on every start. Open the address: the **first-run setup** screen creates your account, which becomes the admin. After that, the screen is gone.

The startup log says which features are on and, for the others, which variable would turn them on:

```bash
docker compose logs app | grep -A 10 Features
```

## Behind a reverse proxy

Caddy, the shortest option (`Caddyfile`):

```
jobs.example.com {
  reverse_proxy localhost:3000
}
```

Then set `APP_ORIGIN=https://jobs.example.com` and `TRUST_PROXY=1`, and check `https://jobs.example.com/api/health/request`: `ip` should be your own public IP and `protocol` should be `https`.

## Optional features

Everything below is off until you configure it; see `.env.example` for every variable.

| Feature | How to turn it on |
| --- | --- |
| AI (job-page reading, email sorting, prep packs, Ask, drafts) | Each user adds their own key in Settings → AI. Self-hosters may also set instance keys (`GROQ_API_KEY`, …) that only admins use. |
| Email updates from your inbox | A dedicated Gmail (or any IMAP) mailbox: `FEATURE_EMAIL_INTAKE=true`, `IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD` (an app password). Forward job emails to it. Read-only; checked every 5 minutes. |
| Browser extension | Install it, choose **Server → change** in the popup and enter your address; Chrome asks to allow that one site. Then pair it from Settings → Browser extension. |
| More accounts | `SIGNUP_MODE=invite`, then create invite links in Settings → Invites. `open` sign-up also needs email sending (`SMTP_HOST`, `MAIL_FROM`). |
| Password reset by email | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (any SMTP provider). Without it, reset a password with `docker compose exec app node apps/api/dist/scripts/set-password.js --email you@example.com`. |

## Backups

Everything is in Postgres. Back it up daily, and keep `ENCRYPTION_KEYS` with the backups (separately):

```bash
docker compose exec -T db pg_dump -U jobtracker jobtracker | gzip > backup-$(date +%F).sql.gz
```

Restore into a fresh volume with `gunzip -c backup.sql.gz | docker compose exec -T db psql -U jobtracker jobtracker`.

Each user can also export their own data (JSON and CSV) in Settings → Your data.

## Upgrading

See [UPGRADING.md](UPGRADING.md). In short: back up, pull, `docker compose --profile app up -d --build`.

## Admin tasks

| Task | Command |
| --- | --- |
| Make someone an admin | `docker compose exec app node apps/api/dist/scripts/set-role.js --email them@example.com --role admin` |
| Reset a password | `docker compose exec app node apps/api/dist/scripts/set-password.js --email them@example.com` |
| Create an account without sign-up | `docker compose exec app node apps/api/dist/scripts/create-user.js --email them@example.com` |
| See recent server errors | Settings → Recent errors (admins) |

## Deploy on Railway instead

See [deployment.md](deployment.md): one service built from the Dockerfile plus Railway's Postgres, with migrations as the pre-deploy command.
