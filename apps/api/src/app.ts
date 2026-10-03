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
import { authenticate, requireAuth, sameOriginGuard } from './auth/middleware';
import { authRouter } from './auth/routes';
import { env } from './config/env';
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
    res.json({ ok: true });
  });

  api.use(authenticate(db));
  api.use('/auth', authRouter(db));
  api.use('/applications', requireAuth, applicationsRouter(db));
  api.use('/contacts', requireAuth, contactsRouter(db));
  api.use('/answer-library', requireAuth, answerLibraryRouter(db));
  api.use(trackerRouter(db)); // /follow-ups, /reviews, /companies (each requires auth)

  api.use((_req, _res, next) => next(notFound('Unknown API route')));
  app.use('/api', api);

  if (e.SERVE_WEB) serveWeb(app, e.WEB_DIST_DIR);

  app.use(errorHandler);
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
  app.use(express.static(dir, { index: false, maxAge: '1y', immutable: true }));
  // SPA fallback: every non-API GET returns index.html (never cached, so deploys show up).
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dir, 'index.html'));
  });
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
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
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
};
