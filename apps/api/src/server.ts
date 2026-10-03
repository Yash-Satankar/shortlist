import { createApp } from './app';
import { env } from './config/env';
import { closeDb, getDb } from './db/client';
import { runMigrations } from './db/migrate';
import { logger } from './logger';

async function main() {
  const e = env();
  // Apply pending migrations on boot so a Railway deploy is a single step.
  await runMigrations();

  const app = createApp({ db: getDb() });
  const server = app.listen(e.PORT, () => logger.info(`API listening on :${e.PORT} (${e.NODE_ENV})`));

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
