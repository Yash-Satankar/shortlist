import { closeDb, getDb } from '../db/client';
import { seedDemo } from '../demo/seed';

/**
 * pnpm demo:seed — rebuilds the demo account (DEMO_MODE=true instances only; refuses a database
 * holding any other account). Run in the demo's pre-deploy after migrations; it also reruns nightly.
 */
seedDemo(getDb())
  .then((r) => console.log(`Demo seeded: ${r.applications} fictional applications.`))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
