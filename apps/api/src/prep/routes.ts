import { Router } from 'express';
import { z } from 'zod';
import { requireSession } from '../auth/middleware';
import { requireUserIntent } from '../auth/intent';
import { requireFeature } from '../config/features';
import type { Db } from '../db/client';
import { parse } from '../lib/http';
import { llmErrorHandler } from '../llm/routes';
import { generatePrep, prepState } from './service';

/**
 * /api/prep/:applicationId — interview prep pack (feature `prep`).
 *   GET  → the stored pack (if any), what's outdated, what's missing, and the cost estimate
 *   POST → generate / regenerate (web app only; the user saw the estimate first)
 */
export function prepRouter(db: Db) {
  const router = Router();
  router.use(requireFeature(db, 'prep'));

  router.get('/:applicationId', async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await prepState(db, req.auth!.userId, parse(z.uuid(), req.params.applicationId)));
  });

  router.post('/:applicationId', requireSession, requireUserIntent, async (req, res) => {
    res.json(await generatePrep(db, req.auth!.userId, parse(z.uuid(), req.params.applicationId)));
  });

  router.use(llmErrorHandler);
  return router;
}
