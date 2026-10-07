# Hosting ShortList for free

ShortList is one Docker image plus Postgres, so it runs comfortably on free tiers. Pick by how you'll use it:

| You want | Use | Trade-off |
| --- | --- | --- |
| Always on, for you (and a few friends), with email updates every 5 minutes | **Oracle Cloud Always Free VM** + Docker Compose + Caddy | About an hour of setup; you look after one small server |
| Light use, no server to look after | **Render** (free web service) + **Neon** (free Postgres) | The app sleeps after ~15 idle minutes and takes up to a minute to wake; email polling only runs while it's awake |

Free-tier limits change. Check each provider's current terms before relying on them.

## Option 1: Oracle Cloud Always Free (recommended)

Oracle's Always Free tier includes Arm (Ampere A1) compute that's far more than ShortList needs. ShortList's image and Postgres both run on Arm.

### Create the VM

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (a card is needed for verification; Always Free resources aren't charged). Pick a home region close to you (for India: Mumbai or Hyderabad). It can't be changed later.
2. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 24.04** (or 22.04)
   - Shape: **VM.Standard.A1.Flex** (Ampere), 1 OCPU and 6 GB RAM is plenty
   - Add your SSH public key, then create.
3. **Open ports 80 and 443.** In the instance's subnet → Security list → **Add ingress rules** for TCP 80 and 443 from `0.0.0.0/0`. Ubuntu images on Oracle also have their own firewall rules; on the VM:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
4. Point a domain (or a free subdomain, e.g. from DuckDNS) at the VM's public IP with an `A` record.

### Install and run

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# ShortList
git clone https://github.com/Yash-Satankar/shortlist.git && cd shortlist
cp .env.example .env
```

Edit `.env`: `ENCRYPTION_KEYS=k1:<key>` (generate with `openssl rand -base64 32`, and keep a copy somewhere safe), `ENCRYPTION_ACTIVE_KEY_ID=k1`, `APP_ORIGIN=https://jobs.example.com`, `TRUST_PROXY=1`, and a strong `POSTGRES_PASSWORD`. Then:

```bash
docker compose --profile app up -d
```

### HTTPS with Caddy

Caddy gets and renews the certificate by itself:

```bash
sudo apt install -y caddy
echo 'jobs.example.com {
  reverse_proxy localhost:3000
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Open `https://jobs.example.com`: the first-run screen creates your admin account. Back up the database regularly (see [self-hosting](self-hosting.md#backups)); a nightly `cron` job writing to object storage or another machine is enough.

## Option 2: Render + Neon (light use)

The same setup as the public demo, without `DEMO_MODE`: follow [the demo guide](demo.md), and set instead:

- `SIGNUP_MODE=closed` (you create your account on the first-run screen) and leave `DEMO_MODE` unset;
- your own `ENCRYPTION_KEYS`, and keep a copy;
- the same Docker command, `node apps/api/dist/scripts/start.js` (without `DEMO_MODE` it only migrates, then starts).

Because the free web service sleeps, background jobs (email polling, the nightly clean-up) only run while someone is using it. Neon keeps your data when the app sleeps.

## Email (both options)

### Sign-in emails: password reset and address confirmation

Any SMTP provider works. Two with free plans:

- **[Resend](https://resend.com)**: verify your domain, create an API key, then `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=resend`, `SMTP_PASSWORD=<API key>`, `MAIL_FROM=ShortList <no-reply@yourdomain>`.
- **[Brevo](https://www.brevo.com)**: SMTP & API → SMTP, then `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER=<your Brevo login>`, `SMTP_PASSWORD=<SMTP key>`, `MAIL_FROM` with a sender address you verified there.

Without SMTP everything still works; "Forgot password" is hidden, and an admin resets passwords from the command line.

### Job emails coming in: Cloudflare Email Routing

ShortList reads job emails from a dedicated mailbox over IMAP (read-only). With a domain on Cloudflare, **Email Routing** (free) gives you a clean address that forwards there:

1. Create a dedicated Gmail account for job emails, turn on 2-step verification, and create an **app password**.
2. In Cloudflare: your domain → **Email → Email Routing** → enable, then add a custom address, e.g. `jobs@yourdomain`, forwarding to that Gmail (confirm the verification email it sends).
3. Use `jobs@yourdomain` when you apply, or set a filter in your main inbox that forwards job emails to it.
4. In `.env`: `FEATURE_EMAIL_INTAKE=true`, `IMAP_HOST=imap.gmail.com`, `IMAP_USER=<the dedicated Gmail>`, `IMAP_PASSWORD=<app password>`.

ShortList checks the mailbox every 5 minutes (`EMAIL_POLL_CRON`), and Settings → Email updates shows when it last read it.
