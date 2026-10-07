# ADR 0009: A built-in error log instead of a hosted tracker

Status: accepted

## Decision
Unexpected server errors (5xx) and failed background jobs are written to `app_errors`, sanitized (emails, keys and long tokens masked; route patterns only, never ids or bodies) and purged after `ERROR_LOG_RETENTION_DAYS`. Admins see them in Settings → Recent errors. Structured logs (pino) remain the full record.

## Why not Sentry
No third party ever receives users' data, and self-hosters get error visibility without creating an account anywhere.
