import { userFeaturesSchema } from '@jt/shared';
import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { requireSession } from '../auth/middleware';
import { userFeatureStates } from '../config/features';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { parse } from '../lib/http';

/**
 * GET   /api/features → each feature's effective state for the caller (+ their own switches).
 * PATCH /api/features → change the caller's switches (web app only). Switching on never
 *       exceeds what the instance offers: the effective state still says instance_off.
 */
export function featuresRouter(db: Db) {
  const router = Router();

  const read = async (userId: string) => {
    const [row] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
    return { features: await userFeatureStates(db, userId), switches: row?.settings?.features ?? {} };
  };

  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await read(req.auth!.userId));
  });

  router.patch('/', requireSession, async (req, res) => {
    const patch = parse(userFeaturesSchema, req.body);
    // jsonb merge on the server so concurrent edits of other settings aren't lost.
    await db
      .update(users)
      .set({
        settings: sql`jsonb_set(${users.settings}, '{features}', coalesce(${users.settings}->'features', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
      })
      .where(eq(users.id, req.auth!.userId));
    res.json(await read(req.auth!.userId));
  });

  return router;
}
