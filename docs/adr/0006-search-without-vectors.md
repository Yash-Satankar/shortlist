# ADR 0006: Ask: full-text search and exact queries, no embeddings

Status: accepted

## Context
"Ask my job search" needs two kinds of answers. Counting questions ("how many rejections this month?") must be exact. Open questions ("what did Lumen say about notice period?") need the right records, with citations.

## Decision
- **Counting and listing**: the user's AI model only turns the question into a filter (statuses, reached statuses, companies, sources, date range, grouping), validated by a schema. The server runs it as a SQL query scoped to the user. Numbers never come from the model.
- **Open questions**: Postgres full-text search over applications, notes, JDs, screening answers and the timeline, with companies named in the question boosted. The top records go to the model, which must cite them (`[S1]`); citations that don't point at a real source are dropped.
- **Encrypted emails** are decrypted in memory for that one request (the newest `ASK_MAX_EMAILS_SCANNED`), scored there, and never written anywhere decrypted, including the AI cache. They're included only when the user switches it on.
- **No embeddings or pgvector.** A stored embedding of an email is a readable derivative of encrypted text. At one person's scale (hundreds of records), full-text search plus company boosting finds the right records, and a 20-question eval over seeded data checks it.

## Consequences
Exact numbers, verifiable citations, no extra infrastructure, and nothing about encrypted fields leaks into an index. If retrieval quality ever falls short, the eval will show it first.
