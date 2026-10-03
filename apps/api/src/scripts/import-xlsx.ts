import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { cliArgs } from '../lib/cli';
import { closeDb, getDb } from '../db/client';
import { runMigrations } from '../db/migrate';
import { users } from '../db/schema';
import { commitImport, planImport, type ImportPlan } from '../import/service';
import { parseTrackerWorkbook } from '../import/tracker-xlsx';
import { normalizeEmail } from '../users/service';

/**
 * pnpm import:xlsx -- --file ../../Job_Applications_Tracker.xlsx [--email you@x.com] [--commit]
 * Without --commit it's a dry run: prints what would happen and writes nothing.
 */
async function main() {
  const { values } = parseArgs({
    args: cliArgs(),
    options: { file: { type: 'string' }, email: { type: 'string' }, commit: { type: 'boolean', default: false } },
  });
  if (!values.file) throw new Error('Usage: pnpm import:xlsx -- --file <path.xlsx> [--email you@x.com] [--commit]');
  const email = values.email ?? process.env.SEED_USER_EMAIL;
  if (!email) throw new Error('Pass --email (or set SEED_USER_EMAIL)');

  await runMigrations();
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(email)) });
  if (!user) throw new Error(`No user with email ${email}`);

  const parsed = await parseTrackerWorkbook(await readFile(values.file));
  const fileName = path.basename(values.file);
  const plan = values.commit ? await commitImport(db, user.id, parsed, fileName) : await planImport(db, user.id, parsed);
  print(plan, values.commit ?? false);
}

function print(plan: ImportPlan, committed: boolean) {
  console.log(committed ? '\n=== IMPORT COMMITTED ===' : '\n=== DRY RUN (nothing written; add --commit to import) ===');
  console.table(
    plan.rows.map(({ action, row, match }) => ({
      '#': row.ref,
      action,
      company: row.companyName.slice(0, 24),
      role: row.roleTitle.slice(0, 34),
      applied: row.appliedOn,
      status: row.status,
      source: row.source,
      link: row.jobUrl ? 'yes' : '-',
      match: match?.label?.slice(0, 40) ?? '',
    })),
  );
  console.log('Summary:', plan.summary);
  console.log('Answer library:', plan.answers.library.map((a) => `${a.action === 'create' ? '+' : '='} ${a.question}`).join(' | '));
  console.log('Profile (encrypted where sensitive):', plan.answers.profile.map((p) => `${p.field} ← "${p.question}" (${p.action})`).join(' | '));
  if (plan.answers.skippedSensitive.length) console.log('Skipped sensitive questions:', plan.answers.skippedSensitive);
  if (plan.issues.length) {
    console.log('\nProblem rows:');
    console.table(plan.issues.map((i) => ({ severity: i.severity, '#': i.ref, sheetRow: i.sheetRow, field: i.field, message: i.message })));
  } else {
    console.log('\nNo problem rows.');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeDb);
