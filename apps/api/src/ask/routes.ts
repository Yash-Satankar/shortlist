import { eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireSession } from '../auth/middleware';
import { requireUserIntent } from '../auth/intent';
import { env } from '../config/env';
import { requireFeature } from '../config/features';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { parse } from '../lib/http';
import { llmErrorHandler } from '../llm/routes';
import { ask, askIncludesEmails } from './service';

/**
 * /api/ask — "Ask my job search" (feature `chat`).
 *   POST /           { question } → exact answer (database) or cited answer (sources)
 *   GET  /settings   → { includeEmails, instanceDefault }
 *   PATCH /settings  { includeEmails } (web app only)
 */
export function askRouter(db: Db) {
  const router = Router();

  router.get('/settings', async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ includeEmails: await askIncludesEmails(db, req.auth!.userId), instanceDefault: env().ASK_INCLUDE_EMAILS_DEFAULT });
  });

  router.patch('/settings', requireSession, requireUserIntent, async (req, res) => {
    const { includeEmails } = parse(z.object({ includeEmails: z.boolean() }), req.body);
    await db
      .update(users)
      .set({ settings: sql`jsonb_set(${users.settings}, '{ask}', coalesce(${users.settings}->'ask', '{}'::jsonb) || ${JSON.stringify({ includeEmails })}::jsonb)` })
      .where(eq(users.id, req.auth!.userId));
    res.json({ includeEmails: await askIncludesEmails(db, req.auth!.userId), instanceDefault: env().ASK_INCLUDE_EMAILS_DEFAULT });
  });

  router.post('/', requireSession, requireUserIntent, requireFeature(db, 'chat'), async (req, res) => {
    const { question } = parse(z.object({ question: z.string() }), req.body);
    res.set('Cache-Control', 'no-store').json(await ask(db, req.auth!.userId, question));
  });

  router.use(llmErrorHandler);
  return router;
}
