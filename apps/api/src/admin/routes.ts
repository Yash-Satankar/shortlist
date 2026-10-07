import { desc, eq } from 'drizzle-orm';
import { Router, type RequestHandler } from 'express';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { dataMigrations, users } from '../db/schema';
import { forbidden } from '../lib/http';
import { recentErrors } from '../lib/error-log';
import { parse } from '../lib/http';
import { requireSession } from '../auth/middleware';
import { requireUserIntent } from '../auth/intent';
import { createInvite, listInvites, revokeInvite, signupMode } from '../accounts/service';
import { z } from 'zod';

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

  /** Data migrations that ran on deploy, with their summaries (counts only, never values). */
  router.get('/data-migrations', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ items: await db.select().from(dataMigrations).orderBy(desc(dataMigrations.appliedAt)) });
  });

  /** Invite links (SIGNUP_MODE=invite). The code is shown once, when created. */
  router.get('/invites', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ items: await listInvites(db), signupMode: signupMode(), ttlDays: env().INVITE_TTL_DAYS });
  });
  router.post('/invites', requireSession, requireUserIntent, async (req, res) => {
    const { email } = parse(z.object({ email: z.email().max(254).nullish() }), req.body ?? {});
    res.status(201).json(await createInvite(db, req.auth!.userId, email));
  });
  router.delete('/invites/:id', requireSession, requireUserIntent, async (req, res) => {
    await revokeInvite(db, parse(z.uuid(), req.params.id));
    res.status(204).end();
  });

  return router;
}
