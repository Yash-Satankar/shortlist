# ADR 0001: Append-only status timeline with undo

Status: accepted

Every status change is a row in `status_events`; nothing is ever updated in place or deleted.

## Context
Statuses change from many places: you, the spreadsheet import, the Android share sheet, the browser extension, job portals, emails and the ghosting rule. When an automatic source gets it wrong, you need to see what happened and put it back.

## Decision
- `status_events` is append-only. Each row records `from → to`, the **source**, a **disposition** (`applied`, `pending_review`, `ignored`, `dismissed`), the rule's reason, a confidence score for automatic sources, and evidence (for example the email it came from).
- `applications.status` is a denormalized copy of the latest applied event, for fast lists.
- **Undo** appends a reverting event and stamps `reverted_at` on the original. Only the latest effective change can be undone; undoing an undo is a redo.

## Consequences
- The timeline explains every status ("Email from greenhouse-mail.io: rejection, high confidence"), and a bad automatic change is one click to reverse.
- Counting questions in Ask ("how many rejections this month?") read the timeline, so they stay correct after undos.
- The table only grows. That's fine at one person's scale (tens of events per application).
