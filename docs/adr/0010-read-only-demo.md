# ADR 0010: The public demo is read-only, not reset nightly

Status: accepted

## Decision
The demo instance (`DEMO_MODE=true`) runs on its own database with fictional data and is entered with "Try the demo". All writes are refused except signing in, Ask and drafts. AI features never call a provider: counting questions are planned by rules and answered by the database, open questions list the matching records, drafts come from templates, and prep packs are pre-generated. The fictional data is rebuilt nightly so its dates stay current.

## Why not writable with a nightly reset
Visitors would see each other's edits, including anything offensive someone types, until the reset. Read-only needs no moderation and no clean-up. The seed refuses any database holding a non-demo account, so it can't touch real data even if misconfigured.
