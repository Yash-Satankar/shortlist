import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createApplication } from '../src/applications/service';
import { closeDb, getDb } from '../src/db/client';
import { DATA_MIGRATIONS, runDataMigrations } from '../src/db/data-migrations';
import { applications, dataMigrations } from '../src/db/schema';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const CTC = DATA_MIGRATIONS.filter((m) => m.id === '0011-expected-ctc-lpa');
let userId: string;

const newApp = async (name: string) =>
  (await createApplication(db, userId, { companyName: name, roleTitle: 'Dev', status: 'applied', via: 'manual', confirmDuplicate: false }, 'manual')).application.id;

/** Writes a value the way the old code did (free text, encrypted by the column type). */
const setLegacy = (id: string, text: string) => db.update(applications).set({ expectedCtcEnc: text }).where(eq(applications.id, id));
const stored = async (id: string) => (await db.select({ v: applications.expectedCtcEnc }).from(applications).where(eq(applications.id, id)))[0]!.v;

beforeEach(async () => {
  await resetDb();
  await db.delete(dataMigrations);
  userId = (await createUser(db, { email: 'ctc@example.com', password: 'correct horse battery' })).id;
});
afterAll(closeDb);

describe('data migration 0011: expected CTC text → number of lakhs', () => {
  it('converts parseable values, leaves the rest untouched and lists them by id only', async () => {
    const a = await newApp('A');
    const b = await newApp('B');
    const c = await newApp('C');
    const d = await newApp('D');
    await setLegacy(a, '12 LPA');
    await setLegacy(b, '12.5 lpa');
    await setLegacy(c, '12'); // already canonical
    await setLegacy(d, '12-15 negotiable');

    const log: string[] = [];
    expect(await runDataMigrations(db, (l) => log.push(l), CTC)).toBe(1);

    expect([await stored(a), await stored(b), await stored(c), await stored(d)]).toEqual(['12', '12.5', '12', '12-15 negotiable']);
    const out = log.join('\n');
    expect(out).toContain('4 value(s): 2 converted, 1 already numeric, 1 left for manual fix');
    expect(out).toContain(`application ${d}`);
    expect(out).not.toMatch(/negotiable|12 LPA|12\.5/); // ids only, never values
  });

  it('values stay encrypted at rest after conversion', async () => {
    const a = await newApp('A');
    await setLegacy(a, '12 LPA');
    await runDataMigrations(db, () => {}, CTC);
    const raw = await db.execute<{ expected_ctc_enc: string }>(sql`select expected_ctc_enc from applications`);
    expect(raw.rows[0]!.expected_ctc_enc).toMatch(/^v1\./);
  });
});

describe('API: expectedCtcLpa', () => {
  const login = async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'ctc@example.com', password: 'correct horse battery' }).expect(200);
    return agent;
  };

  it('accepts a number, or legacy text parsed strictly; rejects anything unclear', async () => {
    const agent = await login();
    const id = await newApp('A');
    const patch = (body: object) => agent.patch(`/api/applications/${id}`).set('Origin', ORIGIN).send(body);

    expect((await patch({ expectedCtcLpa: 12.5 })).body.application).toMatchObject({ expectedCtcLpa: 12.5, expectedCtcRaw: null });
    expect((await patch({ expectedCtc: '14 LPA' })).body.application.expectedCtcLpa).toBe(14);
    expect((await patch({ expectedCtc: 'negotiable' })).status).toBe(400);
    expect((await patch({ expectedCtcLpa: null })).body.application.expectedCtcLpa).toBeNull();
  });

  it('returns an unparseable legacy value as expectedCtcRaw so it can be fixed', async () => {
    const agent = await login();
    const id = await newApp('A');
    await setLegacy(id, '12-15 negotiable');
    expect((await agent.get(`/api/applications/${id}`)).body.application).toMatchObject({ expectedCtcLpa: null, expectedCtcRaw: '12-15 negotiable' });
  });

  it("can't read or write another user's expected CTC", async () => {
    const id = await newApp('Mine');
    await setLegacy(id, '12');
    await createUser(db, { email: 'other@example.com', password: 'correct horse battery' });
    const other = request.agent(app);
    await other.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'other@example.com', password: 'correct horse battery' }).expect(200);
    expect((await other.get(`/api/applications/${id}`)).status).toBe(404);
    expect((await other.patch(`/api/applications/${id}`).set('Origin', ORIGIN).send({ expectedCtcLpa: 99 })).status).toBe(404);
    expect(await stored(id)).toBe('12');
  });
});
