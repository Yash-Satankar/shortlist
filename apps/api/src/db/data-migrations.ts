import { formatLpa, parseLpa, parseRelocation } from '@jt/shared';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { reprocessUnmatched } from '../email/unmatched';
import { applications, dataMigrations, profiles } from './schema';

/**
 * Data migrations: steps that need application code (shared parsers, the encryption key)
 * and so can't be plain SQL. They run after the SQL migrations in scripts/migrate.ts (the
 * Railway pre-deploy step), each once, in its own transaction, recorded in data_migrations.
 * Rules: never destructive, idempotent, and logs carry counts/ids only, never values.
 */
export interface DataMigration {
  id: string;
  run(tx: Tx, log: (line: string) => void): Promise<string>;
}

/** 0009: split profiles.relocation text into relocation_willing + relocation_preference. */
const relocationSplit: DataMigration = {
  id: '0009-relocation-split',
  async run(tx, log) {
    const rows = await tx
      .select({ userId: profiles.userId, relocation: profiles.relocation })
      .from(profiles)
      .where(and(isNotNull(profiles.relocation), isNull(profiles.relocationWilling), isNull(profiles.relocationPreference)));
    let parsed = 0;
    let ambiguous = 0;
    for (const row of rows) {
      const r = parseRelocation(row.relocation);
      if (r.willing === null && r.preference !== null) {
        ambiguous++;
        log(`  profile ${row.userId}: relocation text was ambiguous; kept verbatim as the preference, willing left unknown`);
      } else {
        parsed++;
      }
      await tx.update(profiles).set({ relocationWilling: r.willing, relocationPreference: r.preference }).where(eq(profiles.userId, row.userId));
    }
    return `${rows.length} profile(s): ${parsed} parsed, ${ambiguous} kept as raw preference`;
  },
};

/**
 * 0011: per-application "Expected CTC I gave" → canonical number of lakhs ("12 LPA" → "12").
 * Values are decrypted/re-encrypted by the column type. Unparseable values are left untouched
 * and listed by application id (never by value) for fixing by hand.
 */
const expectedCtcToLpa: DataMigration = {
  id: '0011-expected-ctc-lpa',
  async run(tx, log) {
    const rows = await tx
      .select({ id: applications.id, value: applications.expectedCtcEnc })
      .from(applications)
      .where(isNotNull(applications.expectedCtcEnc));
    let converted = 0;
    let unchanged = 0;
    const unparseable: string[] = [];
    for (const row of rows) {
      const n = parseLpa(row.value);
      if (n === null) {
        unparseable.push(row.id);
        continue;
      }
      const canonical = formatLpa(n);
      if (canonical === row.value) {
        unchanged++;
        continue;
      }
      await tx.update(applications).set({ expectedCtcEnc: canonical }).where(eq(applications.id, row.id));
      converted++;
    }
    for (const id of unparseable) log(`  application ${id}: expected CTC isn't a clear number of lakhs; left untouched, fix it by hand`);
    return `${rows.length} value(s): ${converted} converted, ${unchanged} already numeric, ${unparseable.length} left for manual fix`;
  },
};

/**
 * 0018: emails left in "Emails to match" before applications could be created from portal
 * confirmations: match them again, or create the application from a confident confirmation.
 * Counts only in the log and summary.
 */
const reprocessUnmatchedEmails: DataMigration = {
  id: '0018-reprocess-unmatched-emails',
  async run(tx, log) {
    const r = await reprocessUnmatched(tx as unknown as Db);
    log(`  ${r.checked} unmatched email(s): ${r.created} created an application, ${r.matched} matched one, ${r.stillUnmatched} still to match`);
    return `${r.checked} checked, ${r.created} created, ${r.matched} matched, ${r.stillUnmatched} still unmatched`;
  },
};

export const DATA_MIGRATIONS: DataMigration[] = [relocationSplit, expectedCtcToLpa, reprocessUnmatchedEmails];

export async function runDataMigrations(db: Db, log: (line: string) => void, migrations = DATA_MIGRATIONS): Promise<number> {
  let applied = 0;
  for (const m of migrations) {
    const ran = await db.transaction(async (tx) => {
      // One runner at a time; re-check inside the lock so a concurrent deploy can't double-apply.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jt-data-migrations'))`);
      const done = await tx.select({ id: dataMigrations.id }).from(dataMigrations).where(eq(dataMigrations.id, m.id));
      if (done.length) return false;
      log(`Data migration ${m.id}:`);
      const summary = await m.run(tx, log);
      await tx.insert(dataMigrations).values({ id: m.id, summary });
      log(`  ${summary}`);
      return true;
    });
    if (ran) applied++;
  }
  return applied;
}
