# ADR 0004: Field-level AES-256-GCM for sensitive data

Status: accepted

## Decision
Sensitive columns are encrypted in the application with AES-256-GCM before they reach Postgres, transparently through a Drizzle custom type (`*_enc` columns): CTC figures, recruiter contacts, portal snapshots, stored emails, prep packs, AI cache entries and users' AI keys. Keys are versioned (`ENCRYPTION_KEYS=k1:…,k2:…`) so they can be rotated.

Job descriptions, notes and screening answers stay plaintext so Postgres full-text search works on them.

## Consequences
- A database dump or backup alone doesn't reveal salaries, contacts, emails or keys.
- Encrypted fields can't be indexed or searched by Postgres; [ADR 0006](0006-search-without-vectors.md) covers how Ask searches emails anyway.
- Losing the key loses those fields, so the docs say to keep it in a password manager.
