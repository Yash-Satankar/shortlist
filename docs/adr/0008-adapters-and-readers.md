# ADR 0008: Site adapters read the rendered page only, defensively

Status: accepted

## Decision
The extension reads job pages and application lists with one adapter per site plus a generic reader. Each reads only the page as rendered: no scrolling, clicking, pagination or extra requests, and nothing is ever fetched from a server. Fields come from site DOM hooks, then schema.org JSON-LD, then meta tags, then a content heuristic, and each records where it came from.

Every site is off by default; switching it on is Chrome's permission for that site. A reader is marked "verified" only together with a real captured page that proves it (a test enforces this). Unverified readers drop incomplete rows instead of guessing, and everything automatic becomes a proposal or goes through the status rules.

## Consequences
A site redesign degrades to "Couldn't read this page" rather than wrong data.
