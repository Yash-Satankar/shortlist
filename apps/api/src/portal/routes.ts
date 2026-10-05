import { portalReviewSchema, portalSyncRequestSchema } from '@jt/shared';
import { Router } from 'express';
import { resolveSource, USER_ONLY, USER_OR_AUTO } from '../auth/intent';
import type { Db } from '../db/client';
import { parse } from '../lib/http';
import { pendingProposals, recordSync, reviewProposals } from './service';

/**
 * /api/portal-sync
 *   POST /          a list read by the extension (automatic on an enabled site, or Sync this page)
 *   GET  /pending   proposals waiting for review
 *   POST /review    accept / dismiss proposals (a user action: web app or extension popup)
 */
export function portalRouter(db: Db) {
  const router = Router();

  router.post('/', async (req, res) => {
    resolveSource(req, USER_OR_AUTO);
    res.json(await recordSync(db, req.auth!.userId, parse(portalSyncRequestSchema, req.body)));
  });

  router.get('/pending', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ items: await pendingProposals(db, req.auth!.userId) });
  });

  router.post('/review', async (req, res) => {
    resolveSource(req, USER_ONLY);
    res.json(await reviewProposals(db, req.auth!.userId, parse(portalReviewSchema, req.body)));
  });

  return router;
}
