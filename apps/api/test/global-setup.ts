import './setup-env';
import { closeDb } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

export async function setup() {
  await runMigrations();
  await closeDb();
}
