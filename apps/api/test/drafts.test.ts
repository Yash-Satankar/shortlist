import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { fitToLimit } from '../src/drafts/service';
import { providerFactory, type ProviderClient } from '../src/llm/providers';
import { resetLlmRateLimits } from '../src/llm/service';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';

const calls: { system: string; user: string }[] = [];
let replies: unknown[] = [];
const fake = (): ProviderClient => ({
  async validate() {},
  async complete(model, req) {
    calls.push({ system: req.system, user: req.user });
    return { text: JSON.stringify(replies.shift() ?? { subject: null, body: 'Hi' }), model, inputTokens: 400, outputTokens: 120 };
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
const draft = (a: Agent, body: Record<string, unknown>) => a.post('/api/drafts').set('Origin', ORIGIN).send({ applicationId: appId, ...body });

beforeEach(async () => {
  await resetDb();
  await createUser(db, { email: 'me@example.com', password: PASSWORD, name: 'Asha' });
  await createUser(db, { email: 'other@example.com', password: PASSWORD });
  providerFactory.create = fake;
  resetLlmRateLimits();
  calls.length = 0;
  replies = [];
  me = await login('me@example.com');
  other = await login('other@example.com');
  appId = (await me.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Tessera', roleTitle: 'Full Stack Engineer', status: 'applied', appliedOn: '2026-09-20' }).expect(201)).body.application.id;
  await me.patch('/api/profile').set('Origin', ORIGIN).send({ fullName: 'Asha R' }).expect(200);
});
afterEach(() => {
  providerFactory.create = realCreate;
  delete process.env.LINKEDIN_NOTE_MAX_CHARS;
  resetEnvCache();
});
afterAll(closeDb);

describe('follow-up drafts (never sent)', () => {
  it('email: subject + body, addressed to the recruiter for the mailto link; their address never goes to the model', async () => {
    await me.post(`/api/applications/${appId}/contacts`).set('Origin', ORIGIN).send({ name: 'Priya Sharma', role: 'recruiter', email: 'priya@tessera.example' }).expect(201);
    replies = [{ subject: 'Full Stack Engineer application', body: 'Hi Priya,\n\nI applied on 20 Sep…\n\nThanks,\nAsha R' }];
    const d = (await draft(me, { channel: 'email', purpose: 'no_response' }).expect(200)).body;
    expect(d).toEqual({ channel: 'email', subject: 'Full Stack Engineer application', body: 'Hi Priya,\n\nI applied on 20 Sep…\n\nThanks,\nAsha R', maxChars: null, to: 'priya@tessera.example' });
    expect(calls[0]!.user).toContain('First name: Priya');
    expect(calls[0]!.user).not.toContain('priya@tessera.example');
    expect(calls[0]!.user).not.toContain('Sharma');
  });

  it('LinkedIn note: hard limit, one stricter retry, then trimmed to fit', async () => {
    const long = `${'I enjoyed learning about Tessera’s data platform work. '.repeat(8)}`;
    replies = [{ subject: null, body: long }, { subject: null, body: long }];
    const d = (await draft(me, { channel: 'linkedin_note' }).expect(200)).body;
    expect(d).toMatchObject({ channel: 'linkedin_note', subject: null, maxChars: 300, to: null });
    expect(d.body.length).toBeLessThanOrEqual(300);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.system).toContain('MUST be under 280');
  });

  it('LinkedIn note within the limit: no retry; the limit is env-tunable', async () => {
    process.env.LINKEDIN_NOTE_MAX_CHARS = '200';
    resetEnvCache();
    replies = [{ subject: null, body: 'Hi! I applied for the Full Stack Engineer role at Tessera and would love to connect.' }];
    const d = (await draft(me, { channel: 'linkedin_note' }).expect(200)).body;
    expect(d.maxChars).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain('at most 200 characters');
  });

  it('LinkedIn message: no subject, no limit', async () => {
    replies = [{ subject: 'ignored', body: 'Hi, following up on my application.' }];
    expect((await draft(me, { channel: 'linkedin_message', instructions: 'Mention I can start in 30 days' }).expect(200)).body).toMatchObject({ subject: null, maxChars: null });
    expect(calls[0]!.user).toContain('<user_note>Mention I can start in 30 days</user_note>');
  });

  it('cross-user: someone else’s application → 404, nothing sent to the model', async () => {
    expect((await draft(other, { channel: 'email' })).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('switched off → 403; bad channel → 400', async () => {
    await me.patch('/api/features').set('Origin', ORIGIN).send({ followup_drafts: false }).expect(200);
    expect((await draft(me, { channel: 'email' })).status).toBe(403);
    await me.patch('/api/features').set('Origin', ORIGIN).send({ followup_drafts: true }).expect(200);
    expect((await draft(me, { channel: 'sms' })).status).toBe(400);
  });
});

describe('fitToLimit', () => {
  it('ends at the last full sentence that fits, else a word, never over the limit', () => {
    expect(fitToLimit('Short.', 300)).toBe('Short.');
    expect(fitToLimit('First sentence here. Second sentence is much longer than the limit allows.', 40)).toBe('First sentence here.');
    const w = fitToLimit('averyveryverylongwordwithoutspaces and more words', 20);
    expect(w.length).toBeLessThanOrEqual(20);
  });
});
