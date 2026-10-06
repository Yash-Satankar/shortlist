import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { llmCache } from '../src/db/schema';
import { jobDefinitions, purgeExpiredLlmCache } from '../src/jobs';
import { runNow, startJobs, stopJobs } from '../src/jobs/runner';
import { createUser } from '../src/users/service';
import { resetDb } from './helpers';

const db = getDb();
afterAll(async () => {
  await stopJobs();
  process.env.JOBS_ENABLED = 'false';
  resetEnvCache();
  await closeDb();
});

describe('job runner (pg-boss on the test database)', () => {
  it('starts, runs a queued job and records it', async () => {
    process.env.JOBS_ENABLED = 'true';
    resetEnvCache();
    let ran: () => void = () => undefined;
    const done = new Promise<void>((r) => (ran = r));
    const boss = await startJobs(db, [{ name: 'test-ping', cron: '0 0 1 1 *', run: async () => ran() }]);
    expect(boss).not.toBeNull();
    expect(await runNow('test-ping')).toEqual(expect.any(String));
    await expect(Promise.race([done.then(() => 'ran'), new Promise((r) => setTimeout(() => r('timeout'), 20_000))])).resolves.toBe('ran');
    const [row] = (await db.execute(sql`select count(*)::int as n from pgboss.job where name = 'test-ping'`)).rows as { n: number }[];
    expect(row!.n).toBeGreaterThan(0);
  }, 40_000);

  it('a job whose feature the instance doesn’t offer is not scheduled', async () => {
    await stopJobs();
    process.env.FEATURE_EMAIL_INTAKE = 'false';
    resetEnvCache();
    await startJobs(db, [{ name: 'test-gated', cron: '*/5 * * * *', feature: 'email_intake', run: async () => undefined }]);
    const rows = (await db.execute(sql`select name from pgboss.schedule where name = 'test-gated'`)).rows;
    expect(rows).toHaveLength(0);
    delete process.env.FEATURE_EMAIL_INTAKE;
    resetEnvCache();
  }, 40_000);

  it('email polling runs one at a time (stately queue, no retries); an existing queue is brought to that policy', async () => {
    await stopJobs();
    await db.execute(sql`delete from pgboss.queue where name = 'test-poll'`).catch(() => undefined);
    const boss = (await startJobs(db, [{ name: 'test-poll', cron: '0 0 1 1 *', run: async () => undefined }]))!;
    expect(await boss.getQueue('test-poll')).toMatchObject({ policy: 'standard' });
    await stopJobs();
    const again = (await startJobs(db, [{ name: 'test-poll', cron: '0 0 1 1 *', policy: 'stately', retryLimit: 0, run: async () => undefined }]))!;
    expect(await again.getQueue('test-poll')).toMatchObject({ policy: 'stately', retryLimit: 0 });
    const poll = jobDefinitions().find((j) => j.name === 'email-poll')!;
    expect(poll).toMatchObject({ policy: 'stately', retryLimit: 0, cron: '*/5 * * * *' });
  }, 40_000);

  it('every defined job has a cron from env', () => {
    for (const j of jobDefinitions()) expect(j.cron.split(' ').length, j.name).toBe(5);
  });
});

describe('maintenance purge', () => {
  it('removes only expired AI cache entries', async () => {
    await resetDb();
    const u = await createUser(db, { email: 'p@example.com', password: 'correct horse battery' });
    const base = { userId: u.id, task: 'extraction' as const, provider: 'groq' as const, model: 'm', resultEnc: '{}' };
    await db.insert(llmCache).values([
      { ...base, contentHash: 'old', expiresAt: new Date(Date.now() - 1000) },
      { ...base, contentHash: 'new', expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    expect(await purgeExpiredLlmCache(db)).toBe(1);
    expect((await db.select().from(llmCache)).map((r) => r.contentHash)).toEqual(['new']);
  });
});
