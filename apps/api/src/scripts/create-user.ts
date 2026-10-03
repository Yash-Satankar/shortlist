import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { closeDb, getDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { createUser } from '../users/service';

/**
 * pnpm user:create --email you@example.com [--name "Your Name"]
 * Prompts for the password (or reads JT_NEW_PASSWORD for non-interactive use).
 */
async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  if (!values.email) throw new Error('Usage: pnpm user:create --email you@example.com [--name "Your Name"]');

  let password = process.env.JT_NEW_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('Password (min 10 chars): ');
    rl.close();
  }

  await runMigrations();
  const user = await createUser(getDb(), { email: values.email, password, name: values.name });
  console.log(`Created user ${user.email} (${user.id}).`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
