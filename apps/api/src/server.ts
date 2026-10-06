import { createApp } from './app';
import { env } from './config/env';
import { featureSummary } from './config/features';
import { instanceKeys } from './llm/keys';
import { jobDefinitions } from './jobs';
import { startJobs, stopJobs } from './jobs/runner';
import { closeDb, getDb } from './db/client';
import { logger } from './logger';
import { signupMode } from './accounts/service';
import { mailEnabled } from './lib/mailer';

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
    if (signupMode() === 'open') logger.warn('Instance AI keys are set while sign-up is open. They still serve admins only, but a public instance should run without them (BYOK).');
  }
  if (e.ALLOW_SIGNUP && !e.SIGNUP_MODE) logger.warn('ALLOW_SIGNUP is deprecated: set SIGNUP_MODE=open (or invite / closed) instead.');
  if ((e.SIGNUP_MODE ?? (e.ALLOW_SIGNUP ? 'open' : 'closed')) === 'open' && signupMode() !== 'open') {
    logger.warn('SIGNUP_MODE=open needs email sending (SMTP_HOST, MAIL_FROM) to verify addresses; until then sign-up works by invite only.');
  }
  logger.info(`Sign-up: ${signupMode()}${mailEnabled() ? ' · email sending on' : ' · email sending off (no password reset by email)'}`);
  if (e.LLM_ALLOW_PRIVATE_BASE_URLS && signupMode() === 'open') {
    logger.warn('LLM_ALLOW_PRIVATE_BASE_URLS=true with sign-up open: users could make this server call your private network. Turn one of them off.');
  }

  // Which optional features this instance offers, and why the others are off.
  logger.info(`Features:\n  ${featureSummary(e).join('\n  ')}`);

  // Background jobs (daily purge of expired snapshots/cache; email intake when offered).
  await startJobs(getDb(), jobDefinitions()).catch((err: unknown) => logger.error({ err }, 'Background jobs failed to start'));

  const server = app.listen(e.PORT, () =>
    logger.info(
      { port: e.PORT, env: e.NODE_ENV, trustProxy: e.TRUST_PROXY, origin: e.APP_ORIGIN, sessionTtlDays: e.SESSION_TTL_DAYS, serveWeb: e.SERVE_WEB },
      'API listening',
    ),
  );

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => void stopJobs().finally(() => void closeDb().finally(() => process.exit(0))));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
