import { PgBoss } from 'pg-boss';
import type { Feature } from '@jt/shared';
import { env } from '../config/env';
import { instanceFeatures } from '../config/features';
import type { Db } from '../db/client';
import { logger } from '../logger';

/**
 * Background jobs (pg-boss: a queue kept in Postgres, schema "pgboss"), run inside the API
 * process. Every schedule is an env var. A job whose feature this instance doesn't offer is
 * never scheduled; per-user feature switches are checked inside each job.
 */
export interface JobContext {
  db: Db;
}

export interface JobDef {
  name: string;
  /** Cron expression (from env). */
  cron: string;
  /** The instance must offer this feature for the job to be scheduled at all. */
  feature?: Feature;
  run: (ctx: JobContext) => Promise<unknown>;
}

let boss: PgBoss | null = null;

export async function startJobs(db: Db, jobs: JobDef[]): Promise<PgBoss | null> {
  const e = env();
  if (!e.JOBS_ENABLED) {
    logger.info('Background jobs disabled (JOBS_ENABLED=false)');
    return null;
  }
  boss = new PgBoss({ connectionString: e.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (err: unknown) => logger.error({ err }, 'Job runner error'));
  await boss.start();

  const offered = instanceFeatures();
  for (const job of jobs) {
    await boss.createQueue(job.name);
    if (job.feature && !offered[job.feature].offered) {
      await boss.unschedule(job.name).catch(() => undefined);
      logger.info({ job: job.name, feature: job.feature }, 'Job not scheduled: feature not offered on this instance');
      continue;
    }
    await boss.schedule(job.name, job.cron, null, { tz: e.DEFAULT_TIMEZONE });
    await boss.work(job.name, async () => {
      const started = Date.now();
      try {
        const result = await job.run({ db });
        logger.info({ job: job.name, ms: Date.now() - started, result }, 'Job done');
      } catch (err) {
        logger.error({ err, job: job.name }, 'Job failed');
        throw err; // pg-boss records the failure (and retries per queue policy)
      }
    });
  }
  logger.info({ jobs: jobs.map((j) => `${j.name} @ ${j.cron}`) }, 'Background jobs started');
  return boss;
}

/** Run a job now (e.g. "Check now" in Settings); returns the queued job id. */
export async function runNow(name: string, data: object | null = null): Promise<string | null> {
  if (!boss) return null;
  return boss.send(name, data);
}

export async function stopJobs(): Promise<void> {
  await boss?.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
  boss = null;
}
