import { env } from '../config/env';
import { closeDb, getDb } from '../db/client';
import { preflight, runMigrations } from '../db/migrate';
import { ensureSeedUser, removeDemo, seedDemo } from '../db/seed';

/**
 * pnpm db:seed [--demo | --remove-demo]. Development only; see src/db/seed.ts.
 */
(async () => {
  if (env().NODE_ENV === 'production') {
    throw new Error('db:seed is development-only. In production use `pnpm user:create`.');
  }
  const db = getDb();
  await preflight();
  await runMigrations();
  const userId = await ensureSeedUser(db);
  if (process.argv.includes('--remove-demo')) {
    const removed = await removeDemo(db, userId);
    console.log(`Removed demo rows: ${JSON.stringify(removed)}`);
  } else if (process.argv.includes('--demo')) {
    await seedDemo(db, userId);
  }
})()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
