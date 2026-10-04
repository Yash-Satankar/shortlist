import { parseRelocation } from '@jt/shared';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { dataMigrations, profiles } from './schema';

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

export const DATA_MIGRATIONS: DataMigration[] = [relocationSplit];

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
