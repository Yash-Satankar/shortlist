import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { parseEnv, resetEnvCache } from '../src/config/env';
import { featureSummary, instanceFeatures } from '../src/config/features';
import { closeDb, getDb } from '../src/db/client';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';

async function login(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
  return agent;
}
const mintToken = async (agent: ReturnType<typeof request.agent>) => (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'Chrome' })).body.token.token as string;
const withToken = (token: string) => ({ Authorization: `Bearer ${token}`, 'X-JT-Intent': 'user' });

const setEnv = (patch: Record<string, string>) => {
  Object.assign(process.env, patch);
  resetEnvCache();
};
const saved = { ...process.env };

beforeEach(async () => {
  await resetDb();
  await createUser(db, { email: 'a@example.com', password: PASSWORD });
  await createUser(db, { email: 'b@example.com', password: PASSWORD });
});
afterEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('FEATURE_') && !(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  resetEnvCache();
});
afterAll(closeDb);

describe('instance layer (env)', () => {
  it('defaults: everything offered except email intake; AI needs each user’s key', () => {
    const f = instanceFeatures(parseEnv({ ...process.env }));
    expect(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.offered]))).toEqual({
      ai: true, email_intake: false, extension: true, portal_sync: true, prep: true, chat: true, followup_drafts: true,
    });
    expect(f.ai.why).toMatch(/own API key/);
  });

  it('email intake is offered only when its mode is configured; otherwise the summary says what is missing', () => {
    const imapOk = parseEnv({ ...process.env, FEATURE_EMAIL_INTAKE: 'true', EMAIL_INTAKE_MODE: 'imap', IMAP_HOST: 'imap.example.com', IMAP_USER: 'me@example.com', IMAP_PASSWORD: 'app-password' });
    expect(instanceFeatures(imapOk).email_intake).toEqual({ offered: true, why: 'FEATURE_EMAIL_INTAKE=true (imap)' });
    const inboundMissing = parseEnv({ ...process.env, FEATURE_EMAIL_INTAKE: 'true', EMAIL_INTAKE_MODE: 'inbound', INBOUND_EMAIL_DOMAIN: 'in.example.com' });
    expect(instanceFeatures(inboundMissing).email_intake.why).toBe('FEATURE_EMAIL_INTAKE=true (inbound), but INBOUND_WEBHOOK_USER, INBOUND_WEBHOOK_PASSWORD are not set');
  });

  it('email intake switched on without its settings says why, and the summary covers every feature', () => {
    const e = parseEnv({ ...process.env, FEATURE_EMAIL_INTAKE: 'true', FEATURE_CHAT: 'false' });
    expect(instanceFeatures(e).email_intake).toMatchObject({ offered: false, why: expect.stringMatching(/IMAP_HOST, IMAP_USER, IMAP_PASSWORD are not set/) });
    const summary = featureSummary(e);
    expect(summary).toHaveLength(7);
    expect(summary.find((l) => l.includes('chat'))).toMatch(/^off .*FEATURE_CHAT=false/);
  });
});

describe('GET/PATCH /api/features', () => {
  it('reports effective state: AI and its dependents off until a key exists; the rest on', async () => {
    const a = await login('a@example.com');
    const { features, switches } = (await a.get('/api/features').expect(200)).body;
    expect(switches).toEqual({});
    expect(features.extension).toEqual({ enabled: true, reason: null, blockedBy: null });
    expect(features.prep).toEqual({ enabled: false, reason: 'needs_ai_key', blockedBy: 'ai' });
    expect(features.email_intake.reason).toBe('instance_off');
  });

  it('a user can switch a feature off and on again; merges with other switches', async () => {
    const a = await login('a@example.com');
    await a.patch('/api/features').set('Origin', ORIGIN).send({ portal_sync: false }).expect(200);
    const res = await a.patch('/api/features').set('Origin', ORIGIN).send({ extension: false });
    expect(res.body.switches).toEqual({ portal_sync: false, extension: false });
    expect(res.body.features.portal_sync.reason).toBe('user_off');
    const back = await a.patch('/api/features').set('Origin', ORIGIN).send({ extension: true });
    expect(back.body.features.extension.enabled).toBe(true);
  });

  it('switching on cannot exceed the instance', async () => {
    setEnv({ FEATURE_EXTENSION: 'false' });
    const a = await login('a@example.com');
    const res = await a.patch('/api/features').set('Origin', ORIGIN).send({ extension: true }).expect(200);
    expect(res.body.features.extension).toMatchObject({ enabled: false, reason: 'instance_off' });
  });

  it('rejects unknown features and non-booleans; requires sign-in; a token cannot change switches', async () => {
    const a = await login('a@example.com');
    expect((await a.patch('/api/features').set('Origin', ORIGIN).send({ teleport: true })).status).toBe(400);
    expect((await a.patch('/api/features').set('Origin', ORIGIN).send({ prep: 'off' })).status).toBe(400);
    expect((await request(app).get('/api/features')).status).toBe(401);
    const token = await mintToken(a);
    expect((await request(app).patch('/api/features').set(withToken(token)).send({ extension: false })).status).toBe(403);
  });

  it('cross-user: switches are per user', async () => {
    const a = await login('a@example.com');
    const b = await login('b@example.com');
    await a.patch('/api/features').set('Origin', ORIGIN).send({ extension: false }).expect(200);
    const bf = (await b.get('/api/features')).body;
    expect(bf.switches).toEqual({});
    expect(bf.features.extension.enabled).toBe(true);
  });
});

describe('extension feature gate', () => {
  it('user switch off → pairing codes refused, existing tokens get feature_disabled, Disconnect still works', async () => {
    const a = await login('a@example.com');
    const token = await mintToken(a);
    expect((await request(app).get('/api/auth/me').set(withToken(token))).status).toBe(200);

    await a.patch('/api/features').set('Origin', ORIGIN).send({ extension: false }).expect(200);
    const mint = await a.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'x' });
    expect(mint.status).toBe(403);
    expect(mint.body.error.code).toBe('feature_disabled');

    const me = await request(app).get('/api/auth/me').set(withToken(token));
    expect(me.status).toBe(403);
    expect(me.body.error).toMatchObject({ code: 'feature_disabled', message: 'Browser extension is switched off in Settings.', details: { feature: 'extension', reason: 'user_off' } });

    expect((await request(app).post('/api/auth/tokens/self/revoke').set(withToken(token))).status).toBe(204);
    // Listing and revoking from the web app keeps working.
    expect((await a.get('/api/auth/tokens')).status).toBe(200);
  });

  it('instance off → same, with the server message', async () => {
    const a = await login('a@example.com');
    const token = await mintToken(a);
    setEnv({ FEATURE_EXTENSION: 'false' });
    const me = await request(app).get('/api/auth/me').set(withToken(token));
    expect(me.body.error).toMatchObject({ code: 'feature_disabled', message: 'Browser extension isn’t available on this server.' });
  });

  it('cross-user: one user switching the extension off does not affect another user’s tokens', async () => {
    const a = await login('a@example.com');
    const b = await login('b@example.com');
    const bToken = await mintToken(b);
    await a.patch('/api/features').set('Origin', ORIGIN).send({ extension: false }).expect(200);
    expect((await request(app).get('/api/auth/me').set(withToken(bToken))).status).toBe(200);
  });

  it('web sessions are unaffected by the extension switch', async () => {
    const a = await login('a@example.com');
    await a.patch('/api/features').set('Origin', ORIGIN).send({ extension: false }).expect(200);
    expect((await a.get('/api/applications')).status).toBe(200);
  });
});
