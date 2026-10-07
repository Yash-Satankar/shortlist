# Changelog

## 1.0.0 (self-hostable release)

The first public release. Everything below is optional and can be switched off per server (`FEATURE_*`) and per user (Settings → Features).

### Tracking
- Applications with company, role, location, work mode, salary, source, notes and an append-only status timeline (every change shows its source and confidence; undo and review).
- Job description snapshots, screening answers per application, a standard answer library, and a profile (resume text, experience, notice period, relocation; CTC encrypted).
- Follow-ups inbox: changes to review, follow-ups due, post-interview check-ins and ghosting suggestions.
- Kanban board, search across roles, notes, JDs and answers, and spreadsheet import with a dry run.
- Installable PWA with an Android share target ("Share → Job Tracker" opens quick-add, prefilled).

### Automatic updates
- **Chrome extension "Job Status Tracker"**: saves job pages (LinkedIn, Naukri, Greenhouse, Lever, Workday, and a generic reader); detects submitted applications with an in-page Undo; syncs your applications list from job portals as proposals you review. Every site is off by default. It can also point at a self-hosted server.
- **Email updates**: reads a dedicated mailbox (IMAP, read-only, every 5 minutes) or a per-user forwarding address (Postmark inbound). It classifies job emails (received, viewed, assessment, interview, rejected, offer), matches them to applications, and proposes status changes through the shared rules. A failing mailbox shows in Settings and Follow-ups.

### AI (bring your own key)
- Keys for Anthropic, Groq, Together or any OpenAI-compatible endpoint, encrypted and never shown again. Per-task models, a monthly cap in your currency, and a usage view.
- **Interview prep packs** from the JD, your resume and your answers, stored encrypted, marked outdated when an input changes, with the estimated cost shown before generating.
- **Follow-up drafts**: email (opens in your mail app), LinkedIn connection note (character limit enforced) and LinkedIn message. Never sent for you.
- **Ask my job search** (Ctrl/Cmd+K): counting questions answered exactly by the database, other questions answered from your records with citations. Including emails is opt-in.

### Accounts and self-hosting
- `SIGNUP_MODE` (closed, invite, open), first-run setup screen, admin invite links, email verification and password reset over SMTP, `pnpm user:role`.
- Settings → Your data: export everything (JSON) or your applications (CSV), and delete your account.
- Per-user rate limits on expensive endpoints. Admins see recent server errors (sanitized) in Settings.
- `docker compose --profile app up -d` runs Postgres and the app; migrations run on start. `.env.example` documents every variable.
- Public demo mode: fictional data, read-only, AI without provider calls.

### Quality
- CI: typecheck, ESLint, unit and integration tests against Postgres, a 20-question Ask eval, Playwright end-to-end tests (phone and desktop), web build, extension release zip, a production-build check, and a full-history secret scan.
- Route-level code splitting (main bundle 247 kB).

### Upgrading from a pre-release build
Migrations `0014`–`0017` add: email-poll health, prep packs, the error log, and accounts (existing users are marked email-verified). New variables all have safe defaults. See [docs/UPGRADING.md](docs/UPGRADING.md).
