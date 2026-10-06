import { draftRequestSchema } from '@jt/shared';
import { Router } from 'express';
import { requireSession } from '../auth/middleware';
import { requireUserIntent } from '../auth/intent';
import { requireFeature } from '../config/features';
import type { Db } from '../db/client';
import { parse } from '../lib/http';
import { llmErrorHandler } from '../llm/routes';
import { createDraft } from './service';

/** POST /api/drafts { applicationId, channel, purpose, instructions? } → a draft to copy or open in your mail app. Never sent. */
export function draftsRouter(db: Db) {
  const router = Router();
  router.post('/', requireSession, requireUserIntent, requireFeature(db, 'followup_drafts'), async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await createDraft(db, req.auth!.userId, parse(draftRequestSchema, req.body)));
  });
  router.use(llmErrorHandler);
  return router;
}
