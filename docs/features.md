# Optional features

Every optional feature can be switched off, in two layers (`packages/shared/src/features.ts`):

- **Instance** (env `FEATURE_*`, see `.env.example`): what this deployment offers. At startup the API
  logs each feature as on, or off with the reason.
- **User** (Settings → Features, stored in `users.settings.features`): each user can switch features
  off for themselves. They can't switch on anything the instance doesn't offer.

Dependencies apply automatically: prep, chat and follow-up drafts need AI, and portal sync needs
the extension. AI also needs an API key the user may use (BYOK). Everything goes through one
helper, `featureState`/`isEnabled`:

- the API answers `403 feature_disabled` with the reason;
- background jobs skip;
- the web app and extension hide the surface.

API tokens exist only for the extension. With the extension off, token requests are refused,
except self-revoke, so Disconnect still works.
