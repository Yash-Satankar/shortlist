import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '../db/client';
import { users } from '../db/schema';
import { changePassword, normalizeEmail } from '../users/service';

/**
 * pnpm user:password --email you@example.com
 * Sets a new password (prompted, or JT_NEW_PASSWORD) and signs out all sessions.
 * For lock-outs and replacing the seed password; in the app use POST /api/auth/password.
 */
async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  if (!values.email) throw new Error('Usage: pnpm user:password --email you@example.com');

  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(values.email)) });
  if (!user) throw new Error(`No user with email ${values.email}`);

  let password = process.env.JT_NEW_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('New password (min 10 chars): ');
    rl.close();
  }

  await changePassword(db, user.id, password);
  console.log(`Password updated for ${user.email}; all sessions signed out.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
