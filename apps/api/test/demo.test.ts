import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { applications } from '../src/db/schema';
import { DEMO_APPLICATIONS } from '../src/demo/data';
import { seedDemo } from '../src/demo/seed';
import { providerFactory } from '../src/llm/providers';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
let calls = 0;
const real = providerFactory.create;

const demoOn = (on: boolean) => {
  if (on) process.env.DEMO_MODE = 'true';
  else delete process.env.DEMO_MODE;
  resetEnvCache();
};

beforeEach(async () => {
  await resetDb();
  calls = 0;
  providerFactory.create = () => ({ validate: async () => undefined, complete: async () => (calls++, Promise.reject(new Error('no provider in the demo'))) });
});
afterEach(() => {
  providerFactory.create = real;
  demoOn(false);
});
afterAll(closeDb);

describe('demo seed safety', () => {
  it('refuses unless DEMO_MODE=true', async () => {
    await expect(seedDemo(db)).rejects.toThrow(/DEMO_MODE/);
  });

  it('refuses a database that holds any other account (real data can’t be touched)', async () => {
    demoOn(true);
    await createUser(db, { email: 'real@example.com', password: 'correct horse battery' });
    await expect(seedDemo(db)).rejects.toThrow(/other than the demo account/);
    expect(await db.select().from(applications)).toHaveLength(0);
  });

  it('reseeding rebuilds the same fictional data (nightly refresh)', async () => {
    demoOn(true);
    await seedDemo(db);
    await seedDemo(db);
    expect(await db.select().from(applications)).toHaveLength(DEMO_APPLICATIONS.length);
  });
});

describe('the demo instance', () => {
  let agent: ReturnType<typeof request.agent>;
  beforeEach(async () => {
    demoOn(true);
    await seedDemo(db);
    agent = request.agent(createApp({ db }));
    expect((await agent.get('/api/config')).body).toMatchObject({ demo: true, needsSetup: false, signupMode: 'closed' });
    await agent.post('/api/auth/demo').set('Origin', ORIGIN).expect(200);
  });

  it('“Try the demo” signs you in to the fictional account; everything reads', async () => {
    expect((await agent.get('/api/applications?limit=100')).body.total).toBe(DEMO_APPLICATIONS.length);
    expect((await agent.get('/api/stats')).body.needsYou.reviews).toBeGreaterThan(0);
    const features = (await agent.get('/api/features')).body.features;
    expect(features.chat.enabled && features.prep.enabled && features.followup_drafts.enabled).toBe(true);
  });

  it('is read-only: writes are refused with a clear message', async () => {
    const res = await agent.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'X', roleTitle: 'Y' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('demo_read_only');
    const id = (await agent.get('/api/applications?limit=1')).body.items[0].id;
    expect((await agent.post(`/api/applications/${id}/status`).set('Origin', ORIGIN).send({ status: 'offer' })).status).toBe(403);
    expect((await agent.put('/api/ai/keys/groq').set('Origin', ORIGIN).send({ apiKey: 'gsk_xxxxxxxxxxxx' })).status).toBe(403);
    expect((await agent.post('/api/auth/setup').set('Origin', ORIGIN).send({ email: 'a@b.co', password: 'correct horse battery' })).status).toBe(403);
  });

  it('AI features work without any provider call: exact counts, record lists, template drafts, stored prep packs', async () => {
    const count = (await agent.post('/api/ask').set('Origin', ORIGIN).send({ question: 'Which companies have interviewed me?' }).expect(200)).body;
    expect(count.kind).toBe('exact');
    expect(count.result.rows.map((r: { company: string }) => r.company).sort()).toEqual(['Fabrikam Health', 'Lumen Payments']);
    const open = (await agent.post('/api/ask').set('Origin', ORIGIN).send({ question: 'What did Lumen say about idempotency?' }).expect(200)).body;
    expect(open.kind).toBe('search');
    expect(open.citations.length).toBeGreaterThan(0);

    const lumen = (await agent.get('/api/applications?limit=100')).body.items.find((a: { companyName: string }) => a.companyName === 'Lumen Payments');
    const note = (await agent.post('/api/drafts').set('Origin', ORIGIN).send({ applicationId: lumen.id, channel: 'linkedin_note', purpose: 'post_interview' }).expect(200)).body;
    expect(note.body.length).toBeLessThanOrEqual(300);
    const prep = (await agent.get(`/api/prep/${lumen.id}`).expect(200)).body;
    expect(prep.pack.content.likelyQuestions.length).toBeGreaterThan(0);
    expect(prep.outdated).toEqual([]);
    expect((await agent.post(`/api/prep/${lumen.id}`).set('Origin', ORIGIN)).status).toBe(403);
    expect(calls).toBe(0);
  });
});

describe('not a demo', () => {
  it('“Try the demo” doesn’t exist on a normal server', async () => {
    expect((await request(createApp({ db })).post('/api/auth/demo').set('Origin', ORIGIN)).status).toBe(404);
  });
});
