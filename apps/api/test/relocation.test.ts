import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import { DATA_MIGRATIONS, runDataMigrations } from '../src/db/data-migrations';

const RELOCATION = DATA_MIGRATIONS.filter((m) => m.id === '0009-relocation-split');
import { dataMigrations, profiles } from '../src/db/schema';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
let userId: string;

beforeEach(async () => {
  await resetDb();
  await db.delete(dataMigrations);
  userId = (await createUser(db, { email: 'reloc@example.com', password: 'correct horse battery' })).id;
});
afterAll(closeDb);

const login = async (email = 'reloc@example.com') => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: 'correct horse battery' }).expect(200);
  return agent;
};

describe('data migration 0009: relocation text → willing + preference', () => {
  it('splits the existing value, e.g. "Yes (Hyderabad preferred)" → true + "Hyderabad preferred"', async () => {
    await db.update(profiles).set({ relocation: 'Yes (Hyderabad preferred)' }).where(eq(profiles.userId, userId));
    const log: string[] = [];
    expect(await runDataMigrations(db, (l) => log.push(l), RELOCATION)).toBe(1);

    const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(p).toMatchObject({ relocationWilling: true, relocationPreference: 'Hyderabad preferred', relocation: 'Yes (Hyderabad preferred)' }); // old column untouched
    expect(log.join('\n')).toContain('1 profile(s): 1 parsed, 0 kept as raw preference');
  });

  it('keeps ambiguous text verbatim as the preference and leaves willing unknown (logs no values)', async () => {
    await db.update(profiles).set({ relocation: 'Open to Pune' }).where(eq(profiles.userId, userId));
    const log: string[] = [];
    await runDataMigrations(db, (l) => log.push(l), RELOCATION);
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(p).toMatchObject({ relocationWilling: null, relocationPreference: 'Open to Pune' });
    expect(log.join('\n')).not.toContain('Pune');
  });

  it('runs once: recorded in data_migrations, a second run is a no-op', async () => {
    await db.update(profiles).set({ relocation: 'No' }).where(eq(profiles.userId, userId));
    expect(await runDataMigrations(db, () => {}, RELOCATION)).toBe(1);
    // Someone edits the profile afterwards; a re-run must not clobber it.
    await db.update(profiles).set({ relocationWilling: true, relocationPreference: 'Pune' }).where(eq(profiles.userId, userId));
    expect(await runDataMigrations(db, () => {}, RELOCATION)).toBe(0);
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    expect(p).toMatchObject({ relocationWilling: true, relocationPreference: 'Pune' });
    expect((await db.select().from(dataMigrations)).map((r) => r.id)).toEqual(['0009-relocation-split']);
  });

  it('a failing step rolls back and is not recorded', async () => {
    const boom = { id: 'test-boom', run: async () => Promise.reject(new Error('boom')) };
    await expect(runDataMigrations(db, () => {}, [boom])).rejects.toThrow('boom');
    expect(await db.select().from(dataMigrations).where(eq(dataMigrations.id, 'test-boom'))).toEqual([]);
  });
});

describe('profile API: relocation stored as two fields, shown as one line', () => {
  it('composes the text back, and the generated answer stays "Yes (Hyderabad preferred)"', async () => {
    const agent = await login();
    const res = await agent.patch('/api/profile').set('Origin', ORIGIN).send({ relocationWilling: true, relocationPreference: 'Hyderabad preferred' }).expect(200);
    expect(res.body.profile).toMatchObject({ relocation: 'Yes (Hyderabad preferred)', relocationWilling: true, relocationPreference: 'Hyderabad preferred' });

    const items = (await agent.get('/api/answer-library')).body.items;
    expect(items.find((i: { id: string }) => i.id === 'profile:relocation').answer).toBe('Yes (Hyderabad preferred)');
  });

  it('still accepts the text form (importer, older clients) and parses it', async () => {
    const agent = await login();
    const res = await agent.patch('/api/profile').set('Origin', ORIGIN).send({ relocation: 'No (family reasons)' }).expect(200);
    expect(res.body.profile).toMatchObject({ relocationWilling: false, relocationPreference: 'family reasons', relocation: 'No (family reasons)' });
    const [raw] = (await db.execute<{ relocation: string | null }>(sql`select relocation from profiles`)).rows;
    expect(raw!.relocation).toBeNull(); // the deprecated column is no longer written
  });

  it('clearing the row clears both fields', async () => {
    const agent = await login();
    await agent.patch('/api/profile').set('Origin', ORIGIN).send({ relocation: 'Yes' }).expect(200);
    const res = await agent.patch('/api/profile').set('Origin', ORIGIN).send({ relocationWilling: null, relocationPreference: null }).expect(200);
    expect(res.body.profile).toMatchObject({ relocation: null, relocationWilling: null, relocationPreference: null });
  });

  it("another user's profile is untouched", async () => {
    const agent = await login();
    await agent.patch('/api/profile').set('Origin', ORIGIN).send({ relocation: 'Yes (Pune)' }).expect(200);
    await createUser(db, { email: 'other@example.com', password: 'correct horse battery' });
    const other = await login('other@example.com');
    expect((await other.get('/api/profile')).body.profile).toMatchObject({ relocation: null, relocationWilling: null });
  });
});
