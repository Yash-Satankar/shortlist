import { Router } from 'express';
import { z } from 'zod';
import { requireSession, sessionCookieName } from '../auth/middleware';
import { requireUserIntent } from '../auth/intent';
import type { Db } from '../db/client';
import { parse } from '../lib/http';
import { applicationsCsv, deleteAccount, exportUserData } from './data';

/**
 * /api/account — your data (web app only):
 *   GET  /export?format=json|csv   everything you own (JSON) or your applications (CSV)
 *   POST /delete { password }      deletes the account and all its data, then signs out
 */
export function accountRouter(db: Db) {
  const router = Router();
  router.use(requireSession, requireUserIntent);

  router.get('/export', async (req, res) => {
    const { format } = parse(z.object({ format: z.enum(['json', 'csv']).default('json') }), req.query);
    const data = await exportUserData(db, req.auth!.userId);
    const day = new Date().toISOString().slice(0, 10);
    res.set('Cache-Control', 'no-store');
    if (format === 'csv') {
      res.type('text/csv').attachment(`job-tracker-applications-${day}.csv`).send(applicationsCsv(data.applications));
    } else {
      res.type('application/json').attachment(`job-tracker-export-${day}.json`).send(JSON.stringify(data, null, 2));
    }
  });

  router.post('/delete', async (req, res) => {
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    await deleteAccount(db, req.auth!.userId, password);
    res.clearCookie(sessionCookieName(), { path: '/' });
    res.status(204).end();
  });

  return router;
}
