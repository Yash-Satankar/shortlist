import { lt } from 'drizzle-orm';
import { env } from '../config/env';
import type { DbOrTx } from '../db/client';
import { llmCache } from '../db/schema';
import { purgeExpiredSnapshots } from '../portal/service';
import type { JobDef } from './runner';

/** Expired AI cache entries (each entry has its own expiry). */
export async function purgeExpiredLlmCache(db: DbOrTx): Promise<number> {
  return (await db.delete(llmCache).where(lt(llmCache.expiresAt, new Date())).returning({ id: llmCache.id })).length;
}

/** Every background job. Schedules come from env (cron). */
export function jobDefinitions(): JobDef[] {
  const e = env();
  return [
    {
      name: 'maintenance-purge',
      cron: e.JOB_PURGE_CRON,
      run: async ({ db }) => ({ portalSnapshots: await purgeExpiredSnapshots(db), llmCache: await purgeExpiredLlmCache(db) }),
    },
  ];
}
