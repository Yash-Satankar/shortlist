import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client';

/** Wipes all user data (cascades to every user-owned table). */
export async function resetDb() {
  await getDb().execute(sql`truncate table users cascade`);
}

export const ORIGIN = 'http://localhost:5173';
