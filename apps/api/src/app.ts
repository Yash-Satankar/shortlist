import pkg from '../package.json' with { type: 'json' };
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { sql } from 'drizzle-orm';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { answerLibraryRouter } from './answers/routes';
import { applicationsRouter, contactsRouter, trackerRouter } from './applications/routes';
import { requireUserIntent } from './auth/intent';
import { authenticate, requireAuth, sameOriginGuard } from './auth/middleware';
import { importRouter } from './import/routes';
import { profileRouter } from './profile/routes';
import { authRouter } from './auth/routes';
import { env } from './config/env';
import { assertFeature } from './config/features';
import { featuresRouter } from './features/routes';
import { aiRouter } from './llm/routes';
import { askRouter } from './ask/routes';
import { prepRouter } from './prep/routes';
import { draftsRouter } from './drafts/routes';
import { adminRouter } from './admin/routes';
import { accountRouter } from './accounts/routes';
import { signupMode, userCount } from './accounts/service';
import { mailEnabled } from './lib/mailer';
import { expensiveLimiter } from './lib/rate-limits';
import { demoWriteGuard } from './demo/runtime';
import { recordError, routePattern } from './lib/error-log';
import { portalRouter } from './portal/routes';
import { privacyPage } from './privacy';
import { emailsRouter, inboundWebhook } from './email/routes';
import type { Db } from './db/client';
import { HttpError, notFound } from './lib/http';
import { logger } from './logger';

export function createApp({ db }: { db: Db }) {
  const e = env();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', e.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Vite build output is all same-origin; no inline scripts.
          'script-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
        },
      },
    }),
  );
  if (e.NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  const api = express.Router();
  api.use(express.json({ limit: '2mb' })); // JD text can be long
  api.use(cookieParser());
  api.use(sameOriginGuard);

  api.get('/health', async (_req, res) => {
    await db.execute(sql`select 1`);
    // Readable from any origin (it says only "ok"): the docs site's "Try the demo" page waits on it
    // while a free-hosted demo wakes up.
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ ok: true });
  });

  // Public, non-sensitive settings the signed-out screens need (e.g. the login hint).
  api.get('/config', (_req, res) => {
    // Public: what the signed-out screens need (sign-up, first-run setup, password reset).
    void userCount(db).then(
      (n) => res.json({ sessionTtlDays: e.SESSION_TTL_DAYS, signupMode: signupMode(), needsSetup: n === 0 && !e.DEMO_MODE, emailEnabled: mailEnabled(), version: pkg.version, sourceUrl: e.SOURCE_CODE_URL, ...(e.DEMO_MODE ? { demo: true } : {}) }),
      () => res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } }),
    );
  });

  // Proxy diagnostics: how this server resolves the caller's own request. Behind
  // Railway (TRUST_PROXY=1) ip must be your public IP and protocol "https".
  api.get('/health/request', (req, res) => {
    res.set('Cache-Control', 'no-store');
    // The caller's own forwarding headers, so the proxy hop count can be verified in production.
    res.json({
      ip: req.ip,
      protocol: req.protocol,
      secure: req.secure,
      trustProxy: app.get('trust proxy'),
      forwardedFor: req.get('x-forwarded-for') ?? null,
      realIp: req.get('x-real-ip') ?? null,
    });
  });

  let loggedFirstRequest = false;
  api.use((req, _res, next) => {
    if (!loggedFirstRequest && e.NODE_ENV !== 'test') {
      loggedFirstRequest = true;
      logger.info({ ip: req.ip, protocol: req.protocol, secure: req.secure, xff: req.get('x-forwarded-for') }, 'First request: resolved client');
    }
    next();
  });

  api.use(authenticate(db));
  // API tokens exist for the extension only: with the extension off (instance or user), every
  // token request is refused — except self-revoke, so Disconnect keeps working.
  api.use((req, _res, next) => {
    if (req.auth?.via !== 'token' || (req.method === 'POST' && req.path === '/auth/tokens/self/revoke')) return next();
    assertFeature(db, req.auth.userId, 'extension').then(() => next(), next);
  });
  // The public demo is read-only (sign-in, Ask and drafts excepted).
  api.use(demoWriteGuard);
  // Per-user limits on the expensive endpoints (writes only), before their routes.
  const expensive = expensiveLimiter();
  for (const p of ['/ask', '/prep', '/drafts', '/import', '/profile/resume', '/emails/check', '/ai/extract-job']) api.use(p, expensive);
  api.use('/auth', authRouter(db));
  api.use('/features', requireAuth, featuresRouter(db));
  api.use('/ai', requireAuth, aiRouter(db));
  api.use('/ask', requireAuth, askRouter(db));
  api.use('/prep', requireAuth, prepRouter(db));
  api.use('/drafts', requireAuth, draftsRouter(db));
  api.use('/admin', requireAuth, adminRouter(db));
  api.use('/account', requireAuth, accountRouter(db));
  api.use('/portal-sync', requireAuth, portalRouter(db));
  api.use('/emails', requireAuth, emailsRouter(db));
  api.use('/applications', requireAuth, applicationsRouter(db));
  api.use('/contacts', requireAuth, requireUserIntent, contactsRouter(db));
  api.use('/answer-library', requireAuth, requireUserIntent, answerLibraryRouter(db));
  api.use('/import', requireAuth, importRouter(db));
  api.use('/profile', requireAuth, requireUserIntent, profileRouter(db));
  api.use(trackerRouter(db)); // /follow-ups, /stats, /reviews, /companies (each requires auth)

  api.use((_req, _res, next) => next(notFound('Unknown API route')));
  // Inbound email webhook (Postmark): its own Basic auth; mounted before the CSRF guard.
  app.post('/api/email/inbound/postmark', ...inboundWebhook(db));
  app.use('/api', api);
  // Public privacy policy (Chrome Web Store listing link), rendered from PRIVACY.md.
  app.get('/privacy', privacyPage);

  if (e.SERVE_WEB) serveWeb(app, e.WEB_DIST_DIR);

  app.use(errorHandler(db));
  return app;
}

/** Serves the built React app from the same origin as the API (no cross-site cookies). */
function serveWeb(app: express.Express, configuredDir?: string) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = configuredDir ? path.resolve(configuredDir) : path.resolve(here, '../../web/dist');
  if (!existsSync(path.join(dir, 'index.html'))) {
    logger.warn({ dir }, 'SERVE_WEB is on but the web build was not found; run `pnpm build`');
    return;
  }
  app.use(
    express.static(dir, {
      index: false,
      setHeaders: (res, filePath) => {
        // Hashed build assets never change; everything else (sw.js, manifest, icons)
        // must revalidate or a deploy would never reach installed PWAs.
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  // SPA fallback: every non-API GET returns index.html (never cached, so deploys show up).
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dir, 'index.html'));
  });
}

export const errorHandler = (db: Db): ErrorRequestHandler => (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Malformed JSON body from express.json()
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(err.status ?? 400).json({ error: { code: 'bad_request', message: err.message } });
    return;
  }
  (req.log ?? logger).error({ err }, 'Unhandled error');
  void recordError(db, { kind: 'request', where: routePattern(req.method, req.baseUrl, req.route?.path, req.originalUrl), status: 500, error: err, requestId: req.id ? String(req.id) : null, userId: req.auth?.userId ?? null });
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
};
