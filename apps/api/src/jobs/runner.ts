import { PgBoss, type QueuePolicy } from 'pg-boss';
import type { Feature } from '@jt/shared';
import { env } from '../config/env';
import { instanceFeatures } from '../config/features';
import type { Db } from '../db/client';
import { logger } from '../logger';
import { recordError } from '../lib/error-log';

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
  /**
   * Queue policy (pg-boss): 'stately' = at most one running and one waiting, so a slow run
   * never piles up more. Default 'standard'.
   */
  policy?: QueuePolicy;
  /** Retries of a failed run (default pg-boss's 2). A scheduled job may prefer 0: the next run retries. */
  retryLimit?: number;
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
    await ensureQueue(boss, job);
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
        await recordError(db, { kind: 'job', where: job.name, error: err });
        throw err; // pg-boss records the failure (and retries per queue policy)
      }
    });
  }
  logger.info({ jobs: jobs.map((j) => `${j.name} @ ${j.cron}`) }, 'Background jobs started');
  return boss;
}

/** Creates the queue, or brings an existing one to the job's policy / retry settings. */
async function ensureQueue(b: PgBoss, job: JobDef) {
  const policy = job.policy ?? 'standard';
  const options = job.retryLimit === undefined ? {} : { retryLimit: job.retryLimit };
  const existing = await b.getQueue(job.name);
  if (existing && existing.policy !== policy) {
    // A queue's policy can't be changed in place; its jobs are only scheduled runs, so recreate it.
    logger.info({ job: job.name, from: existing.policy, to: policy }, 'Recreating job queue with a new policy');
    await b.deleteQueue(job.name);
  } else if (existing) {
    if (Object.keys(options).length) await b.updateQueue(job.name, options);
    return;
  }
  await b.createQueue(job.name, { policy, ...options });
}

export const jobsRunning = () => boss !== null;

/** Run a job now (e.g. "Check now" in Settings); returns the queued job id. */
export async function runNow(name: string, data: object | null = null): Promise<string | null> {
  if (!boss) return null;
  return boss.send(name, data);
}

export async function stopJobs(): Promise<void> {
  await boss?.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
  boss = null;
}
