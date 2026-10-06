import { randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireSession } from '../auth/middleware';
import { resolveSource, USER_ONLY } from '../auth/intent';
import { env } from '../config/env';
import { assertFeature, instanceFeatures } from '../config/features';
import type { Db } from '../db/client';
import { applications, emailCursors, emailInboundAddresses, emails } from '../db/schema';
import { runNow } from '../jobs/runner';
import { forbidden, HttpError, notFound, parse } from '../lib/http';
import { logger } from '../logger';
import { ingestEmail, proposeFromEmail } from './ingest';
import { imapConfig, imapOwnerId, pollImap } from './poll';
import { mailboxKey, postmarkAdapter } from './sources';

const newLocalPart = () => `u-${randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/** /api/emails — status, check now, unmatched emails (assign/dismiss), inbound address. */
export function emailsRouter(db: Db) {
  const router = Router();
  const requireIntake: RequestHandler = (req, _res, next) => {
    assertFeature(db, req.auth!.userId, 'email_intake').then(() => next(), next);
  };

  router.get('/status', async (req, res) => {
    const e = env();
    const offered = instanceFeatures().email_intake;
    const base = { mode: e.EMAIL_INTAKE_MODE, offered: offered.offered, why: offered.offered ? null : offered.why };
    let mailbox: Record<string, unknown> | null = null;
    if (e.EMAIL_INTAKE_MODE === 'imap' && offered.offered) {
      const cfg = imapConfig()!;
      const owner = await imapOwnerId(db);
      if (owner === req.auth!.userId) {
        const [cur] = await db.select().from(emailCursors).where(and(eq(emailCursors.userId, owner), eq(emailCursors.mailboxKey, mailboxKey(cfg))));
        const masked = cfg.user.replace(/^(.{2}).*(@.*)$/, '$1•••$2');
        mailbox = { address: masked, folder: cfg.mailbox, lastRunAt: cur?.lastRunAt ?? null, lastError: cur?.lastError ?? null };
      }
    }
    const [counts] = await db
      .select({
        applied: sql<number>`count(*) filter (where ${emails.outcome} = 'applied')::int`,
        review: sql<number>`count(*) filter (where ${emails.outcome} = 'review')::int`,
        unmatched: sql<number>`count(*) filter (where ${emails.outcome} = 'unmatched')::int`,
      })
      .from(emails)
      .where(eq(emails.userId, req.auth!.userId));
    res.set('Cache-Control', 'no-store').json({ ...base, mailbox, counts });
  });

  router.post('/check', requireSession, requireIntake, async (req, res) => {
    if ((await imapOwnerId(db)) !== req.auth!.userId) throw forbidden('This server’s mailbox belongs to another account');
    const queued = await runNow('email-poll');
    // Without the job runner (tests, JOBS_ENABLED=false) check right away.
    res.json(queued ? { queued: true } : { queued: false, result: await pollImap(db) });
  });

  router.get('/unmatched', async (req, res) => {
    const rows = await db
      .select({ id: emails.id, from: emails.fromEnc, subject: emails.subjectEnc, receivedAt: emails.receivedAt, category: emails.category, confidence: emails.confidence })
      .from(emails)
      .where(and(eq(emails.userId, req.auth!.userId), eq(emails.outcome, 'unmatched')))
      .orderBy(desc(emails.receivedAt))
      .limit(100);
    res.set('Cache-Control', 'no-store').json({ items: rows });
  });

  router.post('/:id/assign', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const id = parse(z.uuid(), req.params.id);
    const { applicationId } = parse(z.object({ applicationId: z.uuid() }), req.body);
    const [email] = await db.select().from(emails).where(and(eq(emails.id, id), eq(emails.userId, req.auth!.userId), eq(emails.outcome, 'unmatched')));
    if (!email) throw notFound('Email not found');
    const [app] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, req.auth!.userId)));
    if (!app) throw notFound('Application not found');
    await db.update(emails).set({ matchedBy: 'company_role' }).where(eq(emails.id, id));
    // You matched it yourself: the classification's own confidence applies (no company cap).
    res.json(await proposeFromEmail(db, req.auth!.userId, id, applicationId, { category: email.category as never }, email.confidence, email.receivedAt, email.fromDomain));
  });

  router.post('/:id/dismiss', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const id = parse(z.uuid(), req.params.id);
    const done = await db
      .update(emails)
      .set({ outcome: 'dismissed' })
      .where(and(eq(emails.id, id), eq(emails.userId, req.auth!.userId), eq(emails.outcome, 'unmatched')))
      .returning({ id: emails.id });
    if (!done.length) throw notFound('Email not found');
    res.status(204).end();
  });

  // Inbound mode: your forwarding address (created on first view), regenerable.
  const inboundAddress = async (userId: string, regenerate: boolean) => {
    const e = env();
    if (e.EMAIL_INTAKE_MODE !== 'inbound' || !instanceFeatures().email_intake.offered) throw new HttpError(404, 'Forwarding addresses are not used on this server', 'not_found');
    const [cur] = await db.select().from(emailInboundAddresses).where(eq(emailInboundAddresses.userId, userId));
    if (cur && !regenerate) return `${cur.localPart}@${e.INBOUND_EMAIL_DOMAIN}`;
    const localPart = newLocalPart();
    await db.insert(emailInboundAddresses).values({ userId, localPart }).onConflictDoUpdate({ target: emailInboundAddresses.userId, set: { localPart, createdAt: new Date() } });
    return `${localPart}@${e.INBOUND_EMAIL_DOMAIN}`;
  };
  router.get('/inbound-address', requireIntake, async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ address: await inboundAddress(req.auth!.userId, false) });
  });
  router.post('/inbound-address/regenerate', requireSession, requireIntake, async (req, res) => {
    res.json({ address: await inboundAddress(req.auth!.userId, true) });
  });

  return router;
}

/**
 * POST /api/email/inbound/postmark — mounted before the CSRF guard (Postmark sends no Origin);
 * protected by the webhook's Basic credentials instead. Always answers 200 for accepted
 * payloads (even ignored ones) so the provider doesn't retry; 401 for bad credentials.
 */
export function inboundWebhook(db: Db): RequestHandler[] {
  return [
    express.json({ limit: '30mb' }),
    async (req, res, next) => {
      try {
        const e = env();
        if (e.EMAIL_INTAKE_MODE !== 'inbound' || !instanceFeatures().email_intake.offered) {
          res.status(404).json({ error: { code: 'not_found', message: 'Inbound email is not enabled' } });
          return;
        }
        const adapter = postmarkAdapter({ domain: e.INBOUND_EMAIL_DOMAIN!, basicUser: e.INBOUND_WEBHOOK_USER!, basicPassword: e.INBOUND_WEBHOOK_PASSWORD! });
        if (!adapter.authorized(req.get('authorization'))) {
          res.status(401).json({ error: { code: 'unauthorized', message: 'Bad webhook credentials' } });
          return;
        }
        const parsed = adapter.parse(req.body);
        if (!parsed) return void res.json({ ok: true, ignored: 'unrecognised payload or recipient' });
        const [owner] = await db.select({ userId: emailInboundAddresses.userId }).from(emailInboundAddresses).where(eq(emailInboundAddresses.localPart, parsed.recipientLocalPart));
        if (!owner) return void res.json({ ok: true, ignored: 'unknown address' });
        try {
          await assertFeature(db, owner.userId, 'email_intake');
        } catch {
          return void res.json({ ok: true, ignored: 'switched off' });
        }
        const result = await ingestEmail(db, owner.userId, 'inbound', parsed.email);
        res.json({ ok: true, outcome: result.outcome });
      } catch (err) {
        logger.error({ err }, 'Inbound email webhook failed');
        next(err);
      }
    },
  ];
}
