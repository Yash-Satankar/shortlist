import { eq } from 'drizzle-orm';
import { Router, type RequestHandler } from 'express';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { forbidden } from '../lib/http';
import { recentErrors } from '../lib/error-log';

/** Admin-only endpoints for running the instance. */
export function adminRouter(db: Db) {
  const router = Router();
  const requireAdmin: RequestHandler = (req, _res, next) => {
    db.select({ role: users.role })
      .from(users)
      .where(eq(users.id, req.auth!.userId))
      .then(([u]) => next(u?.role === 'admin' ? undefined : forbidden('Admins only')), next);
  };
  router.use(requireAdmin);

  /** Recent server errors (sanitized), newest first. */
  router.get('/errors', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ items: await recentErrors(db), retentionDays: env().ERROR_LOG_RETENTION_DAYS });
  });

  return router;
}
