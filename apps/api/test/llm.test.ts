import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { llmKeys, llmUsage, users } from '../src/db/schema';
import { assertSafeBaseUrl, LlmError, providerClient, providerFactory, type ProviderClient, type ResolvedKey } from '../src/llm/providers';
import { parseJsonObject, resetLlmRateLimits } from '../src/llm/service';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';
const GOOD_KEY = 'sk-test-good-key-1234';

// ---------------------------------------------------------------- fake provider

const calls: { key: ResolvedKey; model: string; user: string }[] = [];
let reply: string | (() => never) = '{"roleTitle":"Backend Engineer","companyName":"Acme","location":"Pune","workMode":"hybrid","experienceAsked":null,"salaryListed":null,"jd":"Build APIs."}';
const fake = (key: ResolvedKey): ProviderClient => ({
  async validate() {
    if (!key.apiKey.includes('good')) throw new LlmError('invalid_key', 'The key was rejected.');
  },
  async complete(model, req) {
    calls.push({ key, model, user: req.user });
    if (typeof reply === 'function') reply();
    return { text: reply as string, model, inputTokens: 1000, outputTokens: 200 };
  },
});
const realCreate = providerFactory.create;

async function login(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
  return agent;
}
type Agent = Awaited<ReturnType<typeof login>>;
const addKey = (a: Agent, provider: string, apiKey = GOOD_KEY, baseUrl?: string) => a.put(`/api/ai/keys/${provider}`).set('Origin', ORIGIN).send({ apiKey, baseUrl });
const extract = (a: Agent, text = 'Senior Backend Engineer at Acme. '.repeat(5), missing = ['roleTitle', 'companyName']) =>
  a.post('/api/ai/extract-job').set('Origin', ORIGIN).send({ url: 'https://careers.acme.example/jobs/1', title: 'Jobs', text, missing });

const setEnv = (patch: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  resetEnvCache();
};

beforeEach(async () => {
  await resetDb();
  await createUser(db, { email: 'admin@example.com', password: PASSWORD, name: 'Admin' }); // first user → admin
  await createUser(db, { email: 'b@example.com', password: PASSWORD });
  calls.length = 0;
  reply = '{"roleTitle":"Backend Engineer","companyName":"Acme","location":"Pune","workMode":"hybrid","experienceAsked":null,"salaryListed":null,"jd":"Build APIs."}';
  providerFactory.create = fake;
  resetLlmRateLimits();
});
afterEach(() => {
  providerFactory.create = realCreate;
  setEnv({ GROQ_API_KEY: undefined, LLM_MONTHLY_CAP_DEFAULT: undefined, LLM_MAX_INPUT_CHARS: undefined, LLM_RATE_LIMIT_PER_MIN: undefined });
  vi.unstubAllGlobals();
});
afterAll(closeDb);

describe('roles', () => {
  it('the first account is admin, later ones are users', async () => {
    const rows = await db.select({ email: users.email, role: users.role }).from(users).orderBy(users.createdAt);
    expect(rows).toEqual([
      { email: 'admin@example.com', role: 'admin' },
      { email: 'b@example.com', role: 'user' },
    ]);
  });
});

describe('BYOK keys', () => {
  it('validates, stores encrypted, and never returns the key (last 4 only)', async () => {
    const a = await login('b@example.com');
    const res = await addKey(a, 'anthropic');
    expect(res.status).toBe(200);
    expect(res.body.key).toMatchObject({ provider: 'anthropic', last4: '1234' });
    expect(JSON.stringify(res.body)).not.toContain(GOOD_KEY);
    const listed = await a.get('/api/ai');
    expect(JSON.stringify(listed.body)).not.toContain(GOOD_KEY);
    const [raw] = (await db.execute(sql`select key_enc from llm_keys`)).rows as { key_enc: string }[];
    expect(raw!.key_enc).toMatch(/^v1\./);
    expect(raw!.key_enc).not.toContain(GOOD_KEY);
  });

  it('a rejected key is not stored', async () => {
    const a = await login('b@example.com');
    const res = await addKey(a, 'groq', 'sk-test-bad-key-9999');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('llm_invalid_key');
    expect(await db.select().from(llmKeys)).toHaveLength(0);
  });

  it('one key per provider: saving again replaces it; delete removes it', async () => {
    const a = await login('b@example.com');
    await addKey(a, 'groq').expect(200);
    await addKey(a, 'groq', 'sk-test-good-other-5678').expect(200);
    expect((await a.get('/api/ai')).body.keys).toEqual([expect.objectContaining({ provider: 'groq', last4: '5678' })]);
    await a.delete('/api/ai/keys/groq').set('Origin', ORIGIN).expect(204);
    expect((await a.get('/api/ai')).body.keys).toEqual([]);
    expect((await a.delete('/api/ai/keys/groq').set('Origin', ORIGIN)).status).toBe(404);
  });

  it('custom endpoints must be https and public (no private network, no metadata service)', async () => {
    const a = await login('b@example.com');
    for (const url of ['http://8.8.8.8/v1', 'https://127.0.0.1/v1', 'https://10.1.2.3/v1', 'https://169.254.169.254/latest', 'https://192.168.1.5/v1', 'https://[::1]/v1', 'https://localhost/v1', 'https://postgres.railway.internal/v1', 'https://user:pw@8.8.8.8/v1']) {
      const res = await addKey(a, 'openai_compatible', GOOD_KEY, url);
      expect(res.status, url).toBe(400);
      expect(res.body.error.code, url).toBe('llm_unsafe_base_url');
    }
    expect((await addKey(a, 'openai_compatible', GOOD_KEY, 'https://8.8.8.8/v1')).status).toBe(200);
    expect((await addKey(a, 'openai_compatible', GOOD_KEY)).status).toBe(400);
  });

  it('keys can only be managed from a signed-in web session', async () => {
    const a = await login('b@example.com');
    const token = (await a.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token.token as string;
    const res = await request(app).put('/api/ai/keys/groq').set({ Authorization: `Bearer ${token}`, 'X-JT-Intent': 'user' }).send({ apiKey: GOOD_KEY });
    expect(res.status).toBe(403);
  });

  it('cross-user: keys are per user', async () => {
    const admin = await login('admin@example.com');
    const b = await login('b@example.com');
    await addKey(admin, 'groq').expect(200);
    expect((await b.get('/api/ai')).body.keys).toEqual([]);
    expect((await b.delete('/api/ai/keys/groq').set('Origin', ORIGIN)).status).toBe(404);
    expect((await admin.get('/api/ai')).body.keys).toHaveLength(1);
  });
});

describe('features follow keys', () => {
  it('no key → AI off with "add a key"; a key turns AI and its dependents on', async () => {
    const b = await login('b@example.com');
    expect((await b.get('/api/features')).body.features.prep).toMatchObject({ enabled: false, reason: 'needs_ai_key' });
    const blocked = await extract(b);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toBe('Add an API key in Settings to enable this.');
    await addKey(b, 'groq').expect(200);
    const f = (await b.get('/api/features')).body.features;
    expect(f.ai.enabled && f.prep.enabled && f.chat.enabled).toBe(true);
  });

  it('instance keys serve the admin only', async () => {
    setEnv({ GROQ_API_KEY: 'gsk_instance_good_key' });
    const admin = await login('admin@example.com');
    const b = await login('b@example.com');
    expect((await admin.get('/api/features')).body.features.ai.enabled).toBe(true);
    expect((await admin.get('/api/ai')).body.instanceProviders).toEqual(['groq']);
    expect((await b.get('/api/features')).body.features.ai.enabled).toBe(false);
    expect((await b.get('/api/ai')).body.instanceProviders).toEqual([]);
    await extract(admin).expect(200);
    expect(calls[0]!.key.apiKey).toBe('gsk_instance_good_key');
    const [u] = await db.select().from(llmUsage);
    expect(u!.keySource).toBe('instance');
  });

  it('switching AI off for yourself blocks AI calls even with a key', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    await b.patch('/api/features').set('Origin', ORIGIN).send({ ai: false }).expect(200);
    const res = await extract(b);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('feature_disabled');
    expect(calls).toHaveLength(0);
  });
});

describe('runLlm via /api/ai/extract-job', () => {
  it('returns only the requested fields, picks the task model, logs usage with cost', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'anthropic').expect(200);
    const res = await extract(b);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fields: { roleTitle: 'Backend Engineer', companyName: 'Acme' }, cached: false, provider: 'anthropic', model: 'claude-haiku-4-5' });
    expect(Object.keys(res.body.fields).sort()).toEqual(['companyName', 'roleTitle']);
    expect(calls[0]!.user).toContain('<page>');
    const [u] = await db.select().from(llmUsage);
    // haiku: 1000 in × $1/M + 200 out × $5/M = $0.002
    expect(u).toMatchObject({ task: 'extraction', provider: 'anthropic', model: 'claude-haiku-4-5', keySource: 'user', inputTokens: 1000, outputTokens: 200, ok: true, cached: false });
    expect(u!.costUsd).toBeCloseTo(0.002, 6);
  });

  it('the same input is answered from the cache: the provider is called once', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    await extract(b).expect(200);
    const again = await extract(b);
    expect(again.body.cached).toBe(true);
    expect(calls).toHaveLength(1);
    const usage = (await b.get('/api/ai/usage')).body.mine;
    expect(usage).toMatchObject({ calls: 1, cachedHits: 1, currency: 'INR', cap: 500 });
  });

  it('cross-user: another user’s cached result is never served', async () => {
    const admin = await login('admin@example.com');
    const b = await login('b@example.com');
    await addKey(admin, 'groq').expect(200);
    await addKey(b, 'groq').expect(200);
    await extract(admin).expect(200);
    const res = await extract(b);
    expect(res.body.cached).toBe(false);
    expect(calls).toHaveLength(2);
    expect((await b.get('/api/ai/usage')).body.mine.calls).toBe(1);
  });

  it('the user’s model choice wins; prep prefers Anthropic when both keys exist', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    await addKey(b, 'anthropic').expect(200);
    const overview = (await b.get('/api/ai')).body;
    expect(overview.tasks.extraction).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-20b' });
    expect(overview.tasks.prep).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });
    const changed = await b.patch('/api/ai/settings').set('Origin', ORIGIN).send({ models: { extraction: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } });
    expect(changed.body.tasks.extraction).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    await extract(b).expect(200);
    expect(calls[0]!.model).toBe('claude-sonnet-5-5');
  });

  it('Groq + Together: page reading and email sorting on Groq’s small model; prep and chat on Together 70B', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    await addKey(b, 'together').expect(200);
    const { tasks } = (await b.get('/api/ai')).body;
    expect(tasks.extraction).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-20b' });
    expect(tasks.classification).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-20b' });
    expect(tasks.prep).toMatchObject({ provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' });
    expect(tasks.chat).toMatchObject({ provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' });
  });

  it('default models and provider order are env-tunable', async () => {
    process.env.LLM_DEFAULT_MODELS_JSON = '{"groq": {"extraction": "qwen/qwen3.8-27b"}}';
    process.env.LLM_TASK_PROVIDERS_JSON = '{"classification": ["together"], "prep": ["groq"]}';
    resetEnvCache();
    try {
      const b = await login('b@example.com');
      await addKey(b, 'groq').expect(200);
      await addKey(b, 'together').expect(200);
      const { tasks, defaults } = (await b.get('/api/ai')).body;
      expect(tasks.extraction).toMatchObject({ provider: 'groq', model: 'qwen/qwen3.8-27b' });
      expect(tasks.classification).toMatchObject({ provider: 'together' });
      expect(tasks.prep).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-120b' });
      expect(defaults.groq.extraction).toBe('qwen/qwen3.8-27b');
    } finally {
      delete process.env.LLM_DEFAULT_MODELS_JSON;
      delete process.env.LLM_TASK_PROVIDERS_JSON;
      resetEnvCache();
    }
  });

  it('monthly cap: once reached, calls stop with a clear message (cache hits still work)', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'anthropic').expect(200);
    await b.patch('/api/ai/settings').set('Origin', ORIGIN).send({ monthlyCap: 0.1, usdRate: 88 }).expect(200);
    await extract(b).expect(200); // $0.002 × 88 = ₹0.176 ≥ ₹0.1
    const blocked = await extract(b, 'A different page about a Data Engineer role at Globex. '.repeat(3));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('llm_cap_reached');
    expect(blocked.body.error.message).toMatch(/limit \(INR 0.1\) is used up/);
    expect(calls).toHaveLength(1);
    expect((await extract(b)).body.cached).toBe(true);
  });

  it('a non-JSON answer is a clear error and is logged as failed (not cached)', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    reply = 'Sorry, I cannot help with that.';
    const res = await extract(b);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('llm_bad_output');
    const [u] = await db.select().from(llmUsage);
    expect(u).toMatchObject({ ok: false, errorCode: 'bad_output' });
    reply = '{"roleTitle":"X","companyName":"Y"}';
    expect((await extract(b)).body.cached).toBe(false);
  });

  it('too much text is refused up front, not silently cut', async () => {
    setEnv({ LLM_MAX_INPUT_CHARS: '500' });
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    const res = await extract(b, 'x'.repeat(600));
    expect(res.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('per-user rate limit', async () => {
    setEnv({ LLM_RATE_LIMIT_PER_MIN: '2' });
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    await extract(b, 'Page one about a backend role at Acme Corp in Pune.').expect(200);
    await extract(b, 'Page two about a backend role at Acme Corp in Pune.').expect(200);
    expect((await extract(b, 'Page three about a backend role at Acme Corp in Pune.')).status).toBe(429);
  });

  it('the extension may call it on a user action only', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    const token = (await b.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token.token as string;
    const body = { url: 'https://x.example/j', title: '', text: 'Senior Backend Engineer at Acme. '.repeat(3), missing: ['roleTitle'] };
    expect((await request(app).post('/api/ai/extract-job').set({ Authorization: `Bearer ${token}`, 'X-JT-Intent': 'auto' }).send(body)).status).toBe(403);
    expect((await request(app).post('/api/ai/extract-job').set({ Authorization: `Bearer ${token}`, 'X-JT-Intent': 'user' }).send(body)).status).toBe(200);
  });

  it('usage: the instance summary is for admins only', async () => {
    const admin = await login('admin@example.com');
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    await extract(b).expect(200);
    expect((await b.get('/api/ai/usage')).body.instance).toBeNull();
    const inst = (await admin.get('/api/ai/usage')).body.instance;
    expect(inst).toMatchObject({ calls: 1, activeUsers: 1 });
  });

  it('account deletion removes keys, cache and usage', async () => {
    const b = await login('b@example.com');
    await addKey(b, 'groq').expect(200);
    await extract(b).expect(200);
    await db.delete(users).where(eq(users.email, 'b@example.com'));
    const left = (await db.execute(sql`select (select count(*) from llm_keys) k, (select count(*) from llm_cache) c, (select count(*) from llm_usage) u`)).rows[0];
    expect(left).toEqual({ k: '0', c: '0', u: '0' });
  });
});

describe('providers (no network)', () => {
  it('parseJsonObject tolerates fences and prose, rejects non-JSON', () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Here you go: {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
    expect(() => parseJsonObject('no json here')).toThrow(LlmError);
  });

  it('OpenAI-compatible: JSON mode on Groq, errors mapped, truncation detected', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const groq = providerClient({ provider: 'groq', apiKey: 'gsk_x', baseUrl: null });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ model: 'llama-3.1-8b-instant', choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } })));
    const ok = await groq.complete('llama-3.1-8b-instant', { task: 'extraction', system: 's', user: 'u', maxTokens: 50, json: true });
    expect(ok).toEqual({ text: '{"a":1}', model: 'llama-3.1-8b-instant', inputTokens: 10, outputTokens: 3 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(JSON.parse(init.body)).toMatchObject({ response_format: { type: 'json_object' }, max_tokens: 50 });
    expect(init.headers.Authorization).toBe('Bearer gsk_x');
    expect(init.redirect).toBe('error');

    // Reasoning models (GPT-OSS): low effort, reasoning not returned, room for it in the token budget.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ model: 'openai/gpt-oss-20b', choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 90 } })));
    await groq.complete('openai/gpt-oss-20b', { task: 'classification', system: 's', user: 'u', maxTokens: 60, json: true });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ max_tokens: 60 + 1024, reasoning_effort: 'low', include_reasoning: false, response_format: { type: 'json_object' } });
    expect(JSON.parse(init.body)).not.toHaveProperty('reasoning_effort');

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(groq.validate()).rejects.toMatchObject({ code: 'invalid_key' });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await expect(groq.complete('m', { task: 'chat', system: '', user: '', maxTokens: 1, json: false })).rejects.toMatchObject({ code: 'rate_limited' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Unable to access model foo. Please visit https://api.together.ai/models' } }), { status: 400 }));
    await expect(groq.complete('foo', { task: 'chat', system: '', user: '', maxTokens: 1, json: false })).rejects.toMatchObject({ code: 'provider_error', message: 'Groq error 400: Unable to access model foo. Please visit https://api.together.ai/models' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad key gsk_abcdefghijklmnop' }), { status: 400 }));
    await expect(groq.complete('m', { task: 'chat', system: '', user: '', maxTokens: 1, json: false })).rejects.toMatchObject({ message: 'Groq error 400: bad key [key]' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"a' }, finish_reason: 'length' }] })));
    await expect(groq.complete('m', { task: 'chat', system: '', user: '', maxTokens: 1, json: true })).rejects.toMatchObject({ code: 'bad_output' });
  });

  it('assertSafeBaseUrl allows public https only (unless private addresses are explicitly allowed)', async () => {
    await expect(assertSafeBaseUrl('https://8.8.8.8/v1')).resolves.toBeInstanceOf(URL);
    await expect(assertSafeBaseUrl('https://172.20.0.1/v1')).rejects.toMatchObject({ code: 'unsafe_base_url' });
    await expect(assertSafeBaseUrl('https://[::ffff:10.0.0.1]/v1')).rejects.toMatchObject({ code: 'unsafe_base_url' });
    await expect(assertSafeBaseUrl('ftp://8.8.8.8/')).rejects.toMatchObject({ code: 'unsafe_base_url' });
    setEnv({ LLM_ALLOW_PRIVATE_BASE_URLS: 'true' });
    await expect(assertSafeBaseUrl('http://192.168.1.10:11434/v1')).resolves.toBeInstanceOf(URL);
    setEnv({ LLM_ALLOW_PRIVATE_BASE_URLS: undefined });
  });
});
