# Contributing

Thanks for helping. This is a small project, so the process is light.

## Before you start

- **Bugs**: open an issue with steps to reproduce, what you expected, and the version or commit you run.
- **Features**: open an issue first so we can agree on the shape before you write code. Features should be optional and switchable (see [docs/features.md](docs/features.md)).
- **Security issues**: don't open an issue; see [SECURITY.md](SECURITY.md).

## Working on it

Set up as in [docs/development.md](docs/development.md), then:

```bash
pnpm typecheck && pnpm lint && pnpm test   # what CI runs first
pnpm build && pnpm e2e                     # end-to-end, against the production build
```

- Keep pull requests small and focused, with tests for new behaviour. API changes need a cross-user test (another account must never see or change your data).
- Anything tunable is an environment variable, validated in `apps/api/src/config/env.ts` and documented in `.env.example` (a test checks this).
- Schema changes: edit `apps/api/src/db/schema.ts`, run `pnpm db:generate`, and commit the generated migration. Migrations must never delete user data.
- Automatic status changes go through the shared rules (`packages/shared/src/status.ts`); never set a status directly from a new source.
- Test data is fictional. Never commit real applications, emails, names, salaries or captures of real pages without sanitizing them.

ShortList is licensed under the [AGPL-3.0-only](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
