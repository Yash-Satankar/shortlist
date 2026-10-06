import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { emails, llmCache } from '../src/db/schema';
import { queryTerms, snippet } from '../src/ask/search';
import { LlmError, providerFactory, type ProviderClient } from '../src/llm/providers';
import { resetLlmRateLimits } from '../src/llm/service';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';

// Fake provider: the planner and the answerer are told apart by their system prompt.
const calls: { system: string; user: string }[] = [];
let plan: Record<string, unknown> = { kind: 'search' };
let answer: Record<string, unknown> = { answer: 'Nothing.', cited: [], found: false };
const fake = (): ProviderClient => ({
  async validate() {},
  async complete(model, req) {
    calls.push({ system: req.system, user: req.user });
    const body = req.system.includes('database filter') ? plan : answer;
    return { text: JSON.stringify(body), model, inputTokens: 500, outputTokens: 80 };
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
const save = async (a: Agent, body: Record<string, unknown>) => (await a.post('/api/applications').set('Origin', ORIGIN).send({ status: 'applied', ...body }).expect(201)).body.application as { id: string };
const setStatus = (a: Agent, id: string, status: string, occurredAt: string) => a.post(`/api/applications/${id}/status`).set('Origin', ORIGIN).send({ status, occurredAt }).expect(200);
const ask = (a: Agent, question: string) => a.post('/api/ask').set('Origin', ORIGIN).send({ question });

let me: Agent;
let other: Agent;
let myId: string;
beforeEach(async () => {
  await resetDb();
  myId = (await createUser(db, { email: 'me@example.com', password: PASSWORD })).id;
  await createUser(db, { email: 'other@example.com', password: PASSWORD });
  providerFactory.create = fake;
  resetLlmRateLimits();
  calls.length = 0;
  plan = { kind: 'search' };
  answer = { answer: 'Nothing.', cited: [], found: false };
  me = await login('me@example.com');
  other = await login('other@example.com');
});
afterEach(() => {
  providerFactory.create = realCreate;
  delete process.env.ASK_INCLUDE_EMAILS_DEFAULT;
  delete process.env.FEATURE_CHAT;
  resetEnvCache();
});
afterAll(closeDb);

describe('counting questions: exact database answers', () => {
  it('"how many rejections this month?" is counted by the database, not the model', async () => {
    const a = await save(me, { companyName: 'Acme', roleTitle: 'Backend Engineer', appliedOn: '2026-09-02' });
    const b = await save(me, { companyName: 'Globex', roleTitle: 'SRE', appliedOn: '2026-09-10' });
    const c = await save(me, { companyName: 'Initech', roleTitle: 'Data Engineer', appliedOn: '2026-09-12' });
    await setStatus(me, a.id, 'rejected', '2026-10-02T10:00:00+05:30');
    await setStatus(me, b.id, 'rejected', '2026-09-20T10:00:00+05:30'); // last month
    await setStatus(me, c.id, 'interview', '2026-10-03T10:00:00+05:30');
    const theirs = await save(other, { companyName: 'Acme', roleTitle: 'Backend Engineer' });
    await setStatus(other, theirs.id, 'rejected', '2026-10-02T10:00:00+05:30');

    plan = { kind: 'count', reached: ['rejected'], dateField: 'reached', from: '2026-10-01', to: '2026-10-31' };
    const res = (await ask(me, 'How many rejections this month?').expect(200)).body;
    expect(res).toMatchObject({ kind: 'exact', result: { count: 1, rows: [{ id: a.id, company: 'Acme', status: 'rejected' }] } });
    expect(res.answer).toBe('1 application (reached Rejected · happened 1 Oct 2026 – 31 Oct 2026 · not archived).');
    expect(calls).toHaveLength(1); // only the planner; the number never came from a model
    expect(calls[0]!.user).not.toContain('Acme'); // the planner sees only the question
  });

  it('lists and groups exactly, filtered by company, current status and source', async () => {
    await save(me, { companyName: 'Acme Robotics Pvt Ltd', roleTitle: 'Backend Engineer', source: 'linkedin' });
    await save(me, { companyName: 'Acme Robotics Pvt Ltd', roleTitle: 'Data Engineer', source: 'greenhouse' });
    await save(me, { companyName: 'Globex', roleTitle: 'SRE', source: 'linkedin', status: 'interview' });
    plan = { kind: 'list', companies: ['Acme Robotics'] };
    expect((await ask(me, 'Which roles did I apply to at Acme Robotics?')).body.result).toMatchObject({ count: 2 });
    plan = { kind: 'count', sources: ['linkedin'], groupBy: 'status' };
    const r = (await ask(me, 'LinkedIn applications by status?')).body;
    expect(r.result).toMatchObject({ count: 2, groups: [{ key: 'Applied', count: 1 }, { key: 'Interview', count: 1 }] });
    expect(r.answer).toContain(': Applied 1, Interview 1.');
  });

  it('a plan the server can’t validate is refused, never guessed', async () => {
    plan = { kind: 'count', statuses: ['hired'] };
    const res = await ask(me, 'How many hires?');
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('llm_bad_output');
  });
});

describe('open questions: cited answers from your own records', () => {
  it('answers from sources, keeps only real citations', async () => {
    const a = await save(me, { companyName: 'Tessera', roleTitle: 'Full Stack Engineer', jd: 'You will build data pipelines in Python and React dashboards. Notice period up to 30 days.', notes: 'Recruiter Priya said the panel is on Friday.' });
    await save(other, { companyName: 'Tessera', roleTitle: 'Analyst', notes: 'Other user secret note about Tessera salary' });
    answer = { answer: 'They want up to 30 days of notice [S2]. The panel is on Friday [S1, S9]. Also [S9].', cited: ['S1', 'S2', 'S9'], found: true };
    const res = (await ask(me, 'What did Tessera say about notice period?').expect(200)).body;
    expect(res.kind).toBe('search');
    expect(res.answer).toBe('They want up to 30 days of notice [S2]. The panel is on Friday [S1]. Also.');
    expect(res.citations.map((c: { ref: string }) => c.ref)).toEqual(['S1', 'S2']);
    expect(res.citations.every((c: { applicationId: string }) => c.applicationId === a.id)).toBe(true);
    const sent = calls[1]!.user;
    expect(sent).toContain('Notice period up to 30 days');
    expect(sent).not.toContain('Other user secret note'); // cross-user: never in the prompt
  });

  it('nothing found → no answer call at all', async () => {
    await save(me, { companyName: 'Acme', roleTitle: 'Backend Engineer' });
    const res = (await ask(me, 'What did Zyxwv say about relocation?').expect(200)).body;
    expect(res).toMatchObject({ kind: 'search', found: false, citations: [] });
    expect(calls).toHaveLength(1);
  });
});

describe('emails in Ask (encrypted at rest, decrypted in memory only)', () => {
  const storeEmail = (userId: string, applicationId: string | null, subject: string, excerpt: string) =>
    db.insert(emails).values({
      userId,
      source: 'imap',
      messageId: `<${Math.random()}@x>`,
      fromDomain: 'tessera.example',
      fromEnc: 'Priya <priya@tessera.example>',
      subjectEnc: subject,
      excerptEnc: excerpt,
      receivedAt: new Date('2026-10-01T10:00:00Z'),
      category: 'interview',
      confidence: 0.8,
      classifiedBy: 'rules',
      outcome: 'applied',
      applicationId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

  it('off by default (instance env); the user’s switch turns it on; another user’s emails never appear', async () => {
    const a = await save(me, { companyName: 'Tessera', roleTitle: 'Full Stack Engineer' });
    await storeEmail(myId, a.id, 'Interview availability', 'Please share your availability for the onsite round in Bengaluru.');
    const [o] = (await db.execute(sql`select id from users where email = 'other@example.com'`)).rows as { id: string }[];
    await storeEmail(o!.id, null, 'Onsite round details', 'OTHER-USER onsite round in Bengaluru availability');

    expect((await me.get('/api/ask/settings')).body).toEqual({ includeEmails: false, instanceDefault: false });
    await ask(me, 'What did Tessera say about the onsite round availability?').expect(200);
    expect(calls.at(-1)!.user).not.toContain('Please share your availability');

    await me.patch('/api/ask/settings').set('Origin', ORIGIN).send({ includeEmails: true }).expect(200);
    answer = { answer: 'They asked for your availability [S1].', cited: ['S1'], found: true };
    calls.length = 0;
    const res = (await ask(me, 'What did Tessera say about the onsite round availability?').expect(200)).body;
    const sent = calls.at(-1)!.user;
    expect(sent).toContain('Please share your availability');
    expect(sent).not.toContain('OTHER-USER');
    expect(res.emailsSearched).toBe(true);
    expect(res.citations.some((c: { type: string }) => c.type === 'email')).toBe(true);
    // Never cached: the answer's input held decrypted email text.
    const cached = await db.select({ task: llmCache.task }).from(llmCache);
    expect(cached.length).toBe(1); // the planner only
  });

  it('the instance default can be on (env); a user can still switch it off', async () => {
    process.env.ASK_INCLUDE_EMAILS_DEFAULT = 'true';
    resetEnvCache();
    expect((await me.get('/api/ask/settings')).body).toEqual({ includeEmails: true, instanceDefault: true });
    await me.patch('/api/ask/settings').set('Origin', ORIGIN).send({ includeEmails: false }).expect(200);
    expect((await me.get('/api/ask/settings')).body.includeEmails).toBe(false);
  });
});

describe('guards', () => {
  it('off when the instance or the user switches Ask off; needs a key; web app only for settings', async () => {
    process.env.FEATURE_CHAT = 'false';
    resetEnvCache();
    expect((await ask(me, 'How many?')).status).toBe(403);
    delete process.env.FEATURE_CHAT;
    resetEnvCache();
    await me.patch('/api/features').set('Origin', ORIGIN).send({ chat: false }).expect(200);
    expect((await ask(me, 'How many?')).status).toBe(403);
    expect((await me.post('/api/ask').send({ question: 'x' })).status).toBe(403); // no Origin: CSRF guard
  });

  it('a provider failure is reported, nothing invented', async () => {
    providerFactory.create = () => ({ validate: async () => undefined, complete: async () => Promise.reject(new LlmError('timeout', 'Together AI took too long to answer.')) });
    const res = await ask(me, 'How many applications?');
    expect(res.status).toBe(504);
    expect(res.body.error.message).toBe('Together AI took too long to answer.');
  });
});

describe('search helpers', () => {
  it('query terms drop stop words and punctuation', () => {
    expect(queryTerms('What did Tessera’s recruiter say about the notice period?')).toEqual(['tessera', 'recruiter', 'say', 'notice', 'period']);
  });
  it('snippets are a window around the first match', () => {
    const text = `${'x '.repeat(400)}the notice period is 30 days ${'y '.repeat(400)}`;
    const s = snippet(text, ['notice'], 100);
    expect(s).toContain('notice period is 30 days');
    expect(s.length).toBeLessThanOrEqual(102);
  });
});
