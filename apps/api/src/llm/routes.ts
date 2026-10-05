import { DEFAULT_MODELS, LLM_PROVIDERS, userAiSettingsSchema } from '@jt/shared';
import { eq, sql } from 'drizzle-orm';
import { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { requireSession } from '../auth/middleware';
import { requireUserIntent } from '../auth/intent';
import { assertFeature, instanceFeatures } from '../config/features';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { HttpError, notFound, parse } from '../lib/http';
import { extractJobRequestSchema, extractJobWithAi } from './extract-job';
import { availableKeys, deleteKey, instanceKeys, listKeys, saveKey } from './keys';
import { LlmError, type LlmErrorCode } from './providers';
import { aiSettings, instanceUsageSummary, resolveModel, usageSummary } from './service';

const STATUS: Record<LlmErrorCode, number> = {
  no_key: 403,
  invalid_key: 422,
  rate_limited: 429,
  timeout: 504,
  refused: 422,
  bad_output: 502,
  provider_error: 502,
  cap_reached: 429,
  input_too_long: 413,
  unsafe_base_url: 400,
};

/** LlmError → HTTP with a clear, user-facing message (code `llm_<reason>`). */
export const llmErrorHandler: ErrorRequestHandler = (err, _req, _res, next) => {
  next(err instanceof LlmError ? new HttpError(STATUS[err.code], err.message, `llm_${err.code}`) : err);
};

/** Key management needs only that the instance offers AI (adding a key is how you turn it on). */
const requireAiOffered: RequestHandler = (_req, _res, next) => {
  next(instanceFeatures().ai.offered ? undefined : new HttpError(403, 'AI features aren’t available on this server.', 'feature_disabled', { feature: 'ai', reason: 'instance_off' }));
};

const providerParam = z.enum(LLM_PROVIDERS);
const saveKeySchema = z.object({ apiKey: z.string().trim().min(8, 'That key looks too short').max(500), baseUrl: z.string().trim().max(500).nullish() });

/**
 * /api/ai — keys (BYOK), per-task models, cap/currency, usage, and AI endpoints.
 * Key and settings changes need a web session; AI endpoints also accept the extension's token.
 */
export function aiRouter(db: Db) {
  const router = Router();
  // Validating a key calls the provider: keep that from being used to probe keys.
  const keyLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, keyGenerator: (req) => req.auth!.userId, standardHeaders: 'draft-8', legacyHeaders: false });

  const overview = async (userId: string) => {
    const [settings, keys, available, [me]] = await Promise.all([
      aiSettings(db, userId),
      listKeys(db, userId),
      availableKeys(db, userId),
      db.select({ role: users.role }).from(users).where(eq(users.id, userId)),
    ]);
    const tasks = Object.fromEntries(
      (['extraction', 'classification', 'prep', 'chat'] as const).map((t) => {
        const r = resolveModel(t, available, settings.models);
        return [t, r ? { provider: r.key.provider, model: r.model, keySource: r.key.source } : null];
      }),
    );
    return {
      keys,
      // Admin only: which providers the instance's env keys cover (never the keys).
      instanceProviders: me?.role === 'admin' ? [...instanceKeys().keys()] : [],
      settings: { models: settings.models, monthlyCap: settings.monthlyCap, currency: settings.currency, usdRate: settings.usdRate },
      tasks,
      defaults: DEFAULT_MODELS,
    };
  };

  router.get('/', requireAiOffered, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await overview(req.auth!.userId));
  });

  router.put('/keys/:provider', requireSession, requireUserIntent, requireAiOffered, keyLimiter, async (req, res) => {
    const provider = parse(providerParam, req.params.provider);
    const body = parse(saveKeySchema, req.body);
    const key = await saveKey(db, req.auth!.userId, { provider, apiKey: body.apiKey, baseUrl: body.baseUrl });
    res.json({ key, ...(await overview(req.auth!.userId)) });
  });

  router.delete('/keys/:provider', requireSession, requireUserIntent, async (req, res) => {
    const provider = parse(providerParam, req.params.provider);
    if (!(await deleteKey(db, req.auth!.userId, provider))) throw notFound('No key saved for that provider');
    res.status(204).end();
  });

  router.patch('/settings', requireSession, requireUserIntent, requireAiOffered, async (req, res) => {
    const patch = parse(userAiSettingsSchema, req.body);
    const current = (await aiSettings(db, req.auth!.userId)).models;
    const next = { ...patch, ...(patch.models ? { models: { ...current, ...patch.models } } : {}) };
    await db
      .update(users)
      .set({ settings: sql`jsonb_set(${users.settings}, '{ai}', coalesce(${users.settings}->'ai', '{}'::jsonb) || ${JSON.stringify(next)}::jsonb)` })
      .where(eq(users.id, req.auth!.userId));
    res.json(await overview(req.auth!.userId));
  });

  router.get('/usage', requireAiOffered, async (req, res) => {
    const [me] = await db.select({ role: users.role }).from(users).where(eq(users.id, req.auth!.userId));
    res.set('Cache-Control', 'no-store');
    res.json({ mine: await usageSummary(db, req.auth!.userId), instance: me?.role === 'admin' ? await instanceUsageSummary(db, req.auth!.userId) : null });
  });

  // The extension calls this when rules couldn't read every field. A user action (Save), never automatic.
  router.post('/extract-job', requireUserIntent, async (req, res) => {
    await assertFeature(db, req.auth!.userId, 'ai');
    res.json(await extractJobWithAi(db, req.auth!.userId, parse(extractJobRequestSchema, req.body)));
  });

  router.use(llmErrorHandler);
  return router;
}
