# ADR 0005: Explicit proxy trust (TRUST_PROXY)

Status: accepted

## Context
Rate limits and the signed-in devices list need the client's real IP. Behind Railway there are two hops (its edge, then an internal proxy). Trusting `X-Forwarded-For` blindly lets anyone spoof their IP; trusting nothing makes every visitor share the proxy's IP.

## Decision
`TRUST_PROXY` is the exact number of proxy hops in front of the app (Railway: 2; one reverse proxy: 1; direct: 0), and Express trusts exactly that many. `GET /api/health/request` shows how the server resolved your own request, so the setting can be checked after each deploy. The server warns at startup when production runs with `TRUST_PROXY=0`.

## Consequences
Rate limits work per client and can't be bypassed with a forged header.
