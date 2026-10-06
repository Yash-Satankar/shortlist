import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { E2E_USER } from './playwright.config';

/** Migrates the test database, wipes it, and creates the one E2E account (through the real CLI). */
export default async function globalSetup() {
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: process.env.DATABASE_URL_TEST ?? 'postgres://jobtracker:jobtracker@localhost:5433/jobtracker_test',
    ENCRYPTION_KEYS: process.env.ENCRYPTION_KEYS ?? 'k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ENCRYPTION_ACTIVE_KEY_ID: process.env.ENCRYPTION_ACTIVE_KEY_ID ?? 'k1',
    LOG_LEVEL: 'warn',
  };
  const scripts = path.resolve(import.meta.dirname, '../api/dist/scripts');
  execFileSync(process.execPath, [path.join(scripts, 'migrate.js')], { env, stdio: 'inherit' });
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  await client.query('truncate table users cascade');
  await client.end();
  execFileSync(process.execPath, [path.join(scripts, 'create-user.js'), '--email', E2E_USER.email, '--name', 'E2E Tester'], {
    env: { ...env, JT_NEW_PASSWORD: E2E_USER.password },
    stdio: 'inherit',
  });
}
