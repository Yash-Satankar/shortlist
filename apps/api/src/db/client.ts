import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

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
