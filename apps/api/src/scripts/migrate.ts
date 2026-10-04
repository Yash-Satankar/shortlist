import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../db/client';
import { runDataMigrations } from '../db/data-migrations';
import { preflight, REQUIRED_EXTENSIONS, runMigrations } from '../db/migrate';

/**
 * Railway pre-deploy command (`node apps/api/dist/scripts/migrate.js`) and `pnpm db:migrate`.
 * Any failure exits non-zero, which fails the deploy before the new version starts.
 * Kept as its own entry file: entry-point detection inside a bundled shared module is unreliable.
 */
async function main() {
  const { serverVersion } = await preflight();
  console.log(`Postgres ${serverVersion}; required extensions available (${REQUIRED_EXTENSIONS.join(', ')}).`);
  await runMigrations();
  const dataApplied = await runDataMigrations(getDb(), (line) => console.log(line));
  if (dataApplied) console.log(`Data migrations applied: ${dataApplied}`);
  // A count only (no identities): lets a deploy log prove how many accounts exist.
  const { rows } = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from users`);
  console.log(`Migrations applied. Accounts: ${rows[0]!.n}`);
}

main()
  .catch((err) => {
    // Drizzle wraps driver errors ("Failed query: ..."); the cause has the real reason.
    const cause = (err as { cause?: { message?: string } })?.cause?.message;
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.error(`MIGRATION FAILED: ${message}${cause ? ` (${cause})` : ''}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
