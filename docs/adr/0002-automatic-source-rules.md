# ADR 0002: One set of rules for every automatic source

Status: accepted

All automatic signals (extension, portal sync, email, system) go through one pure function, `decideStatusChange` in `packages/shared/src/status.ts`.

## Context
Automatic sources are useful but fallible: a late "application received" email can arrive after an interview invite, and a scam email can claim an offer.

## Decision
- User actions (manual, import, share sheet, an explicit extension click) always apply.
- Automatic sources only move **forward** along Saved → Applied → Viewed → Assessment → Shortlisted → Interview. Backward signals are recorded as `ignored`.
- Each signal carries a 0–1 confidence. At or above `CONFIDENCE_HIGH_THRESHOLD` (0.8) a forward move applies (undoable); below it, it waits in Follow-ups for review.
- **Rejected** applies only with high confidence. **Offer** always waits for review. Nothing automatic leaves Offer, Rejected or Withdrawn.
- Scores are env-tunable. For example, an email matched only by company is capped at 0.6, while a job portal's notice matched by the job's own link scores 0.92.

## Consequences
- New sources plug in by producing a status and a confidence; they can't bypass the rules.
- The rules are exhaustively unit-tested in `packages/shared`, independent of any source.
