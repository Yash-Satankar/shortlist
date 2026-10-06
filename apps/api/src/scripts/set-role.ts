import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { cliArgs } from '../lib/cli';
import { closeDb, getDb } from '../db/client';
import { users } from '../db/schema';
import { normalizeEmail } from '../users/service';

/**
 * pnpm user:role --email someone@example.com --role admin|user
 * Admins can use instance AI keys, see Recent errors and create invites.
 */
async function main() {
  const { values } = parseArgs({ args: cliArgs(), options: { email: { type: 'string' }, role: { type: 'string' } } });
  if (!values.email || (values.role !== 'admin' && values.role !== 'user')) throw new Error('Usage: pnpm user:role --email someone@example.com --role admin|user');
  const [row] = await getDb().update(users).set({ role: values.role }).where(eq(users.email, normalizeEmail(values.email))).returning({ email: users.email });
  if (!row) throw new Error(`No user with email ${values.email}`);
  console.log(`${row.email} is now ${values.role === 'admin' ? 'an admin' : 'a regular user'}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
