import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { prepPacks } from '../src/db/schema';
import { providerFactory, type ProviderClient } from '../src/llm/providers';
import { resetLlmRateLimits } from '../src/llm/service';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';

const PACK = {
  summary: 'Build data pipelines and React dashboards for analytics clients.',
  strengths: [{ point: 'React and Node experience', evidence: 'Built React dashboards at Kodeworks' }],
  gaps: [{ gap: 'No Spark', howToAddress: 'Mention PySpark coursework and willingness to learn.' }],
  likelyQuestions: [{ question: 'How would you design a data pipeline?', why: 'Core of the role', answerHints: ['Mention the ETL job you built'] }],
  talkingPoints: ['Shipped dashboards used daily'],
  questionsToAsk: ['What does the first 90 days look like?'],
};
const calls: { system: string; user: string; maxTokens: number }[] = [];
let reply: unknown = PACK;
const fake = (): ProviderClient => ({
  async validate() {},
  async complete(model, req) {
    calls.push({ system: req.system, user: req.user, maxTokens: req.maxTokens });
    return { text: JSON.stringify(reply), model, inputTokens: 3000, outputTokens: 900 };
  },
});
const realCreate = providerFactory.create;

type Agent = ReturnType<typeof request.agent>;
async function login(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
  await agent.put('/api/ai/keys/together').set('Origin', ORIGIN).send({ apiKey: 'tgp-test-good-key' }).expect(200);
  return agent;
}
let me: Agent;
let other: Agent;
let appId: string;
const state = (a: Agent = me, id = appId) => a.get(`/api/prep/${id}`);
const generate = (a: Agent = me, id = appId) => a.post(`/api/prep/${id}`).set('Origin', ORIGIN);

beforeEach(async () => {
  await resetDb();
  await createUser(db, { email: 'me@example.com', password: PASSWORD });
  await createUser(db, { email: 'other@example.com', password: PASSWORD });
  providerFactory.create = fake;
  resetLlmRateLimits();
  calls.length = 0;
  reply = PACK;
  me = await login('me@example.com');
  other = await login('other@example.com');
  appId = (await me.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Tessera', roleTitle: 'Full Stack Engineer', status: 'applied' }).expect(201)).body.application.id;
});
afterEach(() => {
  providerFactory.create = realCreate;
  delete process.env.FEATURE_PREP;
  resetEnvCache();
});
afterAll(closeDb);

describe('prep packs', () => {
  it('before generating: no pack, what’s missing, and the cost estimate (Together 70B, INR)', async () => {
    const s = (await state().expect(200)).body;
    expect(s).toMatchObject({ pack: null, outdated: [], missing: ['jd', 'resume'], estimate: { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', currency: 'INR' } });
    expect(s.estimate.cost).toBeGreaterThan(0);
    expect(calls).toHaveLength(0); // estimating never calls the provider
  });

  it('generates from the JD, resume and answers (never CTC), stores it encrypted', async () => {
    await me.post(`/api/applications/${appId}/jd`).set('Origin', ORIGIN).send({ content: 'We need Python, Spark and React. Build data pipelines for analytics clients.' }).expect(201);
    await me.patch('/api/profile').set('Origin', ORIGIN).send({ resumeText: 'Full stack developer. Built React dashboards at Kodeworks.', expectedCtc: '18', currentCtc: '12' }).expect(200);
    await me.post('/api/answer-library').set('Origin', ORIGIN).send({ question: 'Why data engineering?', answer: 'I enjoy building pipelines.' }).expect(201);
    const s = (await generate().expect(200)).body;
    expect(s).toMatchObject({ pack: { content: PACK, provider: 'together' }, outdated: [], missing: [] });
    const sent = calls[0]!.user;
    expect(sent).toContain('Spark and React');
    expect(sent).toContain('Built React dashboards at Kodeworks');
    expect(sent).toContain('I enjoy building pipelines');
    expect(sent).not.toMatch(/\b18\b|\b12\b|CTC/);
    const [raw] = (await db.execute(sql`select content_enc from prep_packs`)).rows as { content_enc: string }[];
    expect(raw!.content_enc).toMatch(/^v1\./);
    expect(raw!.content_enc).not.toContain('pipeline');
  });

  it('marks the pack outdated when the JD, resume or answer library changes; regenerate clears it (a fresh call, not the cache)', async () => {
    await generate().expect(200);
    await me.post(`/api/applications/${appId}/jd`).set('Origin', ORIGIN).send({ content: 'Updated JD: now also Kafka.' }).expect(201);
    expect((await state()).body.outdated).toEqual(['jd']);
    await me.patch('/api/profile').set('Origin', ORIGIN).send({ resumeText: 'New resume text' }).expect(200);
    await me.post('/api/answer-library').set('Origin', ORIGIN).send({ question: 'Why this company?', answer: 'Their analytics work.' }).expect(201);
    expect((await state()).body.outdated).toEqual(['jd', 'resume', 'answers']);
    reply = { ...PACK, summary: 'Regenerated summary.' };
    const s = (await generate().expect(200)).body;
    expect(s).toMatchObject({ outdated: [], pack: { content: { summary: 'Regenerated summary.' } } });
    await generate().expect(200); // same inputs again: still a new call
    expect(calls).toHaveLength(3);
    expect(await db.select().from(prepPacks)).toHaveLength(1);
  });

  it('a malformed answer from the model is refused and nothing is stored', async () => {
    reply = { summary: 'x', likelyQuestions: [] };
    expect((await generate()).status).toBe(502);
    expect(await db.select().from(prepPacks)).toHaveLength(0);
  });

  it('cross-user: another user can’t read or generate a pack for my application', async () => {
    await generate().expect(200);
    expect((await state(other)).status).toBe(404);
    expect((await generate(other)).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('off when the instance or user switches prep off', async () => {
    process.env.FEATURE_PREP = 'false';
    resetEnvCache();
    expect((await state()).status).toBe(403);
    delete process.env.FEATURE_PREP;
    resetEnvCache();
    await me.patch('/api/features').set('Origin', ORIGIN).send({ prep: false }).expect(200);
    expect((await generate()).status).toBe(403);
  });
});
