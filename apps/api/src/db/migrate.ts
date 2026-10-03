import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDb } from './client';

/**
 * Migration library. The CLI entry is src/scripts/migrate.ts (Railway's pre-deploy
 * command). The server itself never migrates, and nothing here seeds data.
 */

/** Extensions the migrations need. pgvector is intentionally absent until a migration needs it. */
export const REQUIRED_EXTENSIONS = ['pg_trgm'];

/**
 * Finds apps/api/drizzle by walking up from this module. Bundled output lives at
 * different depths (dist/server.js vs dist/scripts/migrate.js, or a shared chunk), so a fixed relative path breaks.
 */
function findMigrationsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate the drizzle migrations folder');
}

/** Fails with a clear message before touching the schema if a required extension can't be installed. */
export async function preflight(): Promise<{ serverVersion: string }> {
  const db = getDb();
  const { rows: versionRows } = await db.execute<{ server_version: string }>(sql`show server_version`);
  const { rows } = await db.execute<{ name: string }>(
    sql`select name from pg_available_extensions where name in (${sql.join(REQUIRED_EXTENSIONS.map((e) => sql`${e}`), sql`, `)})`,
  );
  const missing = REQUIRED_EXTENSIONS.filter((e) => !rows.some((r) => r.name === e));
  if (missing.length) {
    throw new Error(`Postgres is missing required extension(s): ${missing.join(', ')}. Use a Postgres image that ships contrib extensions.`);
  }
  return { serverVersion: versionRows[0]!.server_version };
}

export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: findMigrationsDir() });
}
