import { normalizeCompanyName } from '@jt/shared';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { companies } from '../db/schema';
import { badRequest } from '../lib/http';

/** Returns the user's company with this normalized name, creating it if needed. */
export async function findOrCreateCompany(db: DbOrTx, userId: string, name: string) {
  const displayName = name.trim();
  const normalizedName = normalizeCompanyName(displayName);
  if (!normalizedName) throw badRequest('Company name is required');

  // Upsert so concurrent creates (import + extension) can't race into a unique violation.
  const [row] = await db
    .insert(companies)
    .values({ userId, name: displayName, normalizedName })
    .onConflictDoUpdate({
      target: [companies.userId, companies.normalizedName],
      set: { normalizedName: sql`excluded.normalized_name` }, // no-op update so RETURNING yields the row
    })
    .returning();
  return row!;
}

/** Company autocomplete: prefix/substring match first, then fuzzy (pg_trgm). */
export function searchCompanies(db: DbOrTx, userId: string, query: string, limit = 10) {
  const q = query.trim();
  const normalized = normalizeCompanyName(q);
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(
      and(
        eq(companies.userId, userId),
        q
          ? or(ilike(companies.name, `%${escapeLike(q)}%`), sql`similarity(${companies.normalizedName}, ${normalized}) > 0.3`)
          : undefined,
      ),
    )
    .orderBy(q ? sql`similarity(${companies.normalizedName}, ${normalized}) desc` : asc(companies.name))
    .limit(limit);
}

export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
