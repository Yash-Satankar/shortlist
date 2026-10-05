import { createApp } from './app';
import { env } from './config/env';
import { featureSummary } from './config/features';
import { instanceKeys } from './llm/keys';
import { purgeExpiredSnapshots } from './portal/service';
import { closeDb, getDb } from './db/client';
import { logger } from './logger';

/**
 * Starts the HTTP server. Migrations are NOT run here: in production they are the
 * pre-deploy command (`node apps/api/dist/scripts/migrate.js`); in dev `pnpm dev` runs them first.
 */
async function main() {
  const e = env();
  const app = createApp({ db: getDb() });

  if (e.NODE_ENV === 'production' && e.TRUST_PROXY === 0) {
    logger.warn('TRUST_PROXY=0 in production: behind Railway this makes every client share the proxy IP (rate limits) — set TRUST_PROXY=1');
  }

  const keys = [...instanceKeys().keys()];
  if (keys.length) {
    logger.info(`Instance AI keys set for: ${keys.join(', ')} (used by admin accounts only)`);
    if (e.ALLOW_SIGNUP) logger.warn('Instance AI keys are set while sign-up is open. They still serve admins only, but a public instance should run without them (BYOK).');
  }
  if (e.LLM_ALLOW_PRIVATE_BASE_URLS && e.ALLOW_SIGNUP) {
    logger.warn('LLM_ALLOW_PRIVATE_BASE_URLS=true with sign-up open: users could make this server call your private network. Turn one of them off.');
  }

  // Which optional features this instance offers, and why the others are off.
  logger.info(`Features:\n  ${featureSummary(e).join('\n  ')}`);

  // Portal snapshots expire after PORTAL_SNAPSHOT_RETENTION_DAYS: purge at start and daily.
  const purge = () =>
    purgeExpiredSnapshots(getDb())
      .then((n) => n && logger.info({ deleted: n }, 'Expired portal snapshots deleted'))
      .catch((err: unknown) => logger.warn({ err }, 'Portal snapshot purge failed'));
  void purge();
  setInterval(() => void purge(), 24 * 60 * 60 * 1000).unref();

  const server = app.listen(e.PORT, () =>
    logger.info(
      { port: e.PORT, env: e.NODE_ENV, trustProxy: e.TRUST_PROXY, origin: e.APP_ORIGIN, sessionTtlDays: e.SESSION_TTL_DAYS, serveWeb: e.SERVE_WEB },
      'API listening',
    ),
  );

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => void closeDb().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
