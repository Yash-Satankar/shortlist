import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Functions that can run standalone or inside a caller's transaction take this. */
export type DbOrTx = Db | Tx;

let pool: pg.Pool | undefined;
let db: Db | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: env().DATABASE_URL, max: env().DATABASE_POOL_MAX });
  return pool;
}

export function getDb(): Db {
  db ??= drizzle(getPool(), { schema, casing: 'snake_case' });
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

/** Postgres unique_violation, optionally on a specific constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = (err as { cause?: unknown })?.cause ?? err;
  const pgErr = e as { code?: string; constraint?: string };
  return pgErr?.code === '23505' && (!constraint || pgErr.constraint === constraint);
}
