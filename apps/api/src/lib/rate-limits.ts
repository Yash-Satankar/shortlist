import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Per-user limit on the expensive endpoints (AI calls, import, resume parsing, mailbox checks):
 * RATE_LIMIT_EXPENSIVE_PER_MIN writes a minute per account, on top of the AI layer's own limits.
 */
export function expensiveLimiter(): RequestHandler {
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: () => env().RATE_LIMIT_EXPENSIVE_PER_MIN,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? '0.0.0.0'),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' } },
  });
  // Reads stay unlimited; only writes (which do the expensive work) count.
  return (req, res, next) => (req.method === 'GET' ? next() : limiter(req, res, next));
}
