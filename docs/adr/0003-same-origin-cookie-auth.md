# ADR 0003: Same-origin cookie sessions; tokens only for the extension

Status: accepted

## Decision
- The API serves the built web app, so they share one origin. The session cookie is first-party: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`. No CORS, no cross-site cookies.
- Session and API tokens are random 256-bit values stored only as SHA-256 hashes; passwords use argon2id.
- Cookie-authenticated writes must come from `APP_ORIGIN` (Origin / `Sec-Fetch-Site` check), as CSRF protection.
- The Chrome extension uses revocable bearer tokens created by pairing in Settings. They can't create more tokens, export data or delete the account. Each extension request declares its intent (`X-JT-Intent: user | auto`), and endpoints accept only the intents they allow, so automatic reads always get the automatic rules.
- The Android share target uses GET (`/share?title&text&url`) so the `SameSite=Lax` cookie is sent.

## Consequences
Simple, robust auth with no third-party identity provider. Self-hosters must serve the app over HTTPS (any reverse proxy), because `Secure` cookies require it outside localhost.
