import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { invites } from '../src/db/schema';
import { applicationsCsv } from '../src/accounts/data';
import { mailerFactory, type OutgoingMail } from '../src/lib/mailer';
import { providerFactory } from '../src/llm/providers';
import { resetLlmRateLimits } from '../src/llm/service';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
let app = createApp({ db });
const PASSWORD = 'correct horse battery';
const sent: OutgoingMail[] = [];
const realMailer = mailerFactory.create;

const setEnv = (patch: Record<string, string | undefined>) => {
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  resetEnvCache();
  app = createApp({ db });
};
const MAIL = { SMTP_HOST: 'smtp.example.com', MAIL_FROM: 'ShortList <no-reply@example.com>' };
const post = (path: string, body: unknown, agent: ReturnType<typeof request.agent> | null = null) => (agent ?? request(app)).post(path).set('Origin', ORIGIN).send(body as object);
const linkToken = (m: OutgoingMail) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]!;

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  mailerFactory.create = () => ({ send: async (m) => void sent.push(m) });
  setEnv({ SIGNUP_MODE: undefined, SMTP_HOST: undefined, MAIL_FROM: undefined, RATE_LIMIT_EXPENSIVE_PER_MIN: undefined });
});
afterEach(() => {
  mailerFactory.create = realMailer;
});
afterAll(closeDb);

describe('first-run setup', () => {
  it('an empty server asks for setup; setup creates the admin and signs in; then it is gone', async () => {
    expect((await request(app).get('/api/config')).body).toMatchObject({ sessionTtlDays: expect.any(Number), signupMode: 'closed', needsSetup: true, emailEnabled: false });
    const agent = request.agent(app);
    const res = await post('/api/auth/setup', { email: 'Owner@Example.com', password: PASSWORD, name: 'Owner' }, agent).expect(201);
    expect(res.body.user).toMatchObject({ email: 'owner@example.com', role: 'admin' });
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await request(app).get('/api/config')).body.needsSetup).toBe(false);
    expect((await post('/api/auth/setup', { email: 'evil@example.com', password: PASSWORD })).status).toBe(403);
  });

  it('two setups at once create exactly one admin', async () => {
    const results = await Promise.all([post('/api/auth/setup', { email: 'a@example.com', password: PASSWORD }), post('/api/auth/setup', { email: 'b@example.com', password: PASSWORD })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
  });
});

describe('sign-up modes', () => {
  let admin: ReturnType<typeof request.agent>;
  beforeEach(async () => {
    await createUser(db, { email: 'admin@example.com', password: PASSWORD });
    admin = request.agent(app);
    await post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD }, admin).expect(200);
  });

  it('closed: refused', async () => {
    expect((await post('/api/auth/signup', { email: 'new@example.com', password: PASSWORD })).status).toBe(403);
  });

  it('invite: a one-time link signs you in; reused, expired, revoked or for another email → refused', async () => {
    setEnv({ SIGNUP_MODE: 'invite' });
    admin = request.agent(app);
    await post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD }, admin).expect(200);
    const inv = (await post('/api/admin/invites', {}, admin).expect(201)).body;
    expect(inv.link).toBe(`http://localhost:5173/?invite=${inv.code}`);
    expect((await post('/api/auth/signup', { email: 'new@example.com', password: PASSWORD })).status).toBe(403); // no code
    const agent = request.agent(app);
    expect((await post('/api/auth/signup', { email: 'new@example.com', password: PASSWORD, invite: inv.code }, agent).expect(201)).body.user.role).toBe('user');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await post('/api/auth/signup', { email: 'two@example.com', password: PASSWORD, invite: inv.code })).body.error.code).toBe('invite_invalid');

    const bound = (await post('/api/admin/invites', { email: 'Bound@Example.com' }, admin)).body;
    expect((await post('/api/auth/signup', { email: 'other@example.com', password: PASSWORD, invite: bound.code })).body.error.code).toBe('invite_email_mismatch');
    await post('/api/auth/signup', { email: 'bound@example.com', password: PASSWORD, invite: bound.code }).expect(201);

    const old = (await post('/api/admin/invites', {}, admin)).body;
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(sql`${invites.id} = ${old.id}`);
    expect((await post('/api/auth/signup', { email: 'late@example.com', password: PASSWORD, invite: old.code })).status).toBe(403);

    const revoked = (await post('/api/admin/invites', {}, admin)).body;
    await admin.delete(`/api/admin/invites/${revoked.id}`).set('Origin', ORIGIN).expect(204);
    expect((await post('/api/auth/signup', { email: 'rev@example.com', password: PASSWORD, invite: revoked.code })).status).toBe(403);
    const list = (await admin.get('/api/admin/invites')).body;
    expect(JSON.stringify(list)).not.toContain(inv.code); // codes are never listed
  });

  it('only admins manage invites', async () => {
    await createUser(db, { email: 'user@example.com', password: PASSWORD });
    const user = request.agent(app);
    await post('/api/auth/login', { email: 'user@example.com', password: PASSWORD }, user).expect(200);
    expect((await post('/api/admin/invites', {}, user)).status).toBe(403);
  });

  it('open without email sending acts as invite (addresses can’t be verified)', async () => {
    setEnv({ SIGNUP_MODE: 'open' });
    expect((await request(app).get('/api/config')).body.signupMode).toBe('invite');
    expect((await post('/api/auth/signup', { email: 'new@example.com', password: PASSWORD })).status).toBe(403);
  });

  it('open with email: confirm your address first, then you’re in', async () => {
    setEnv({ SIGNUP_MODE: 'open', ...MAIL });
    expect((await post('/api/auth/signup', { email: 'new@example.com', password: PASSWORD }).expect(201)).body).toEqual({ verificationSent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('new@example.com');
    const login = await post('/api/auth/login', { email: 'new@example.com', password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('email_unverified');
    await post('/api/auth/verify/resend', { email: 'new@example.com' }).expect(204);
    expect(sent).toHaveLength(2);
    expect((await post('/api/auth/verify', { token: linkToken(sent[0]!) })).status).toBe(400); // replaced by the resend
    const agent = request.agent(app);
    await post('/api/auth/verify', { token: linkToken(sent[1]!) }, agent).expect(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await post('/api/auth/verify', { token: linkToken(sent[1]!) })).status).toBe(400); // single use
  });
});

describe('password reset by email', () => {
  beforeEach(async () => {
    await createUser(db, { email: 'me@example.com', password: PASSWORD });
  });

  it('hidden without email sending', async () => {
    expect((await post('/api/auth/password-reset/request', { email: 'me@example.com' })).status).toBe(404);
  });

  it('emails a one-time link; the new password works and every session is signed out', async () => {
    setEnv(MAIL);
    const old = request.agent(app);
    await post('/api/auth/login', { email: 'me@example.com', password: PASSWORD }, old).expect(200);
    await post('/api/auth/password-reset/request', { email: 'nobody@example.com' }).expect(204);
    expect(sent).toHaveLength(0); // unknown address: same answer, no mail
    await post('/api/auth/password-reset/request', { email: 'ME@example.com' }).expect(204);
    expect(sent).toHaveLength(1);
    await post('/api/auth/password-reset/confirm', { token: linkToken(sent[0]!), newPassword: 'a whole new passphrase' }).expect(204);
    expect((await old.get('/api/auth/me')).status).toBe(401);
    await post('/api/auth/login', { email: 'me@example.com', password: 'a whole new passphrase' }).expect(200);
    expect((await post('/api/auth/password-reset/confirm', { token: linkToken(sent[0]!), newPassword: 'another passphrase!' })).status).toBe(400);
  });
});

describe('your data: export and delete', () => {
  let me: ReturnType<typeof request.agent>;
  let other: ReturnType<typeof request.agent>;
  beforeEach(async () => {
    await createUser(db, { email: 'admin@example.com', password: PASSWORD });
    await createUser(db, { email: 'me@example.com', password: PASSWORD, name: 'Me' });
    me = request.agent(app);
    other = request.agent(app);
    await post('/api/auth/login', { email: 'me@example.com', password: PASSWORD }, me).expect(200);
    await post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD }, other).expect(200);
    await post('/api/applications', { companyName: 'Acme', roleTitle: '=HYPERLINK("x")', status: 'applied', jd: 'Build things.', expectedCtcLpa: 14, notes: 'line one, "quoted"' }, me).expect(201);
    await me.patch('/api/profile').set('Origin', ORIGIN).send({ currentCtc: '9' }).expect(200);
    await post('/api/applications', { companyName: 'Globex', roleTitle: 'SRE', status: 'applied' }, other).expect(201);
  });

  it('JSON export has everything you own (decrypted for you) and nothing secret or anyone else’s', async () => {
    const res = await me.get('/api/account/export?format=json').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="job-tracker-export-\d{4}-\d{2}-\d{2}\.json"/);
    const data = JSON.parse(res.text);
    expect(data.applications).toHaveLength(1);
    expect(data.applications[0]).toMatchObject({ company: 'Acme', expectedCtc: expect.anything() });
    expect(data.profile.currentCtc).toBe('9');
    expect(data.jobDescriptions[0].content).toBe('Build things.');
    expect(res.text).not.toMatch(/passwordHash|password_hash|tokenHash|keyEnc|Globex/);
  });

  it('CSV export: one row per application, quoted, formulas neutralized', async () => {
    const res = await me.get('/api/account/export?format=csv').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lines = res.text.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('"line one, ""quoted"""');
    expect(applicationsCsv([])).toBe('company,roleTitle,status,source,sourceDetail,location,workMode,experienceAsked,appliedOn,followUpOn,statusChangedAt,jobUrl,salaryListed,notes,archivedAt,createdAt\r\n');
  });

  it('delete needs your password, removes every row you own (AI cache included), and nobody else’s', async () => {
    const meId = ((await db.execute(sql`select id from users where email = 'me@example.com'`)).rows as { id: string }[])[0]!.id;
    await db.execute(sql`insert into llm_cache (user_id, task, content_hash, provider, model, result_enc, expires_at) values (${meId}, 'chat', 'h', 'groq', 'm', 'x', now() + interval '1 day')`);
    expect((await post('/api/account/delete', { password: 'wrong password' }, me)).status).toBe(401);
    await post('/api/account/delete', { password: PASSWORD }, me).expect(204);
    expect((await me.get('/api/auth/me')).status).toBe(401);
    // Every table with a user_id column: nothing left for this user.
    const tables = (await db.execute(sql`select table_name from information_schema.columns where column_name = 'user_id' and table_schema = 'public'`)).rows as { table_name: string }[];
    expect(tables.length).toBeGreaterThan(15);
    for (const { table_name } of tables) {
      const n = ((await db.execute(sql`select count(*)::int as n from ${sql.identifier(table_name)} where user_id = ${meId}`)).rows as { n: number }[])[0]!.n;
      expect(n, table_name).toBe(0);
    }
    expect((await other.get('/api/applications')).body.total).toBe(1);
  });

  it('the only admin can’t leave while other accounts remain', async () => {
    const res = await post('/api/account/delete', { password: PASSWORD }, other);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/only admin/);
  });

  it('only from the web app (an extension token can’t export or delete)', async () => {
    const token = (await post('/api/auth/tokens', { name: 'ext' }, me).expect(201)).body.token;
    expect((await request(app).get('/api/account/export').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
});

describe('per-user limits on expensive endpoints', () => {
  it('writes over the limit get 429; reads and other users are unaffected', async () => {
    setEnv({ RATE_LIMIT_EXPENSIVE_PER_MIN: '2' });
    resetLlmRateLimits();
    const real = providerFactory.create;
    providerFactory.create = () => ({ validate: async () => undefined, complete: async (model) => ({ text: '{"subject":null,"body":"Hi"}', model, inputTokens: 1, outputTokens: 1 }) });
    try {
      await createUser(db, { email: 'a@example.com', password: PASSWORD });
      await createUser(db, { email: 'b@example.com', password: PASSWORD });
      const login = async (email: string) => {
        const a = request.agent(app);
        await post('/api/auth/login', { email, password: PASSWORD }, a).expect(200);
        await a.put('/api/ai/keys/together').set('Origin', ORIGIN).send({ apiKey: 'tgp-test-good-key' }).expect(200);
        return a;
      };
      const a = await login('a@example.com');
      const b = await login('b@example.com');
      const appId = (await post('/api/applications', { companyName: 'Acme', roleTitle: 'SRE', status: 'applied' }, a)).body.application.id;
      const draft = (agent: typeof a) => post('/api/drafts', { applicationId: appId, channel: 'linkedin_message' }, agent);
      expect((await draft(a)).status).toBe(200);
      expect((await draft(a)).status).toBe(200);
      expect((await draft(a)).status).toBe(429);
      expect((await a.get('/api/ask/settings')).status).toBe(200);
      expect((await draft(b)).status).toBe(404); // b isn't limited (and can't see a's application)
    } finally {
      providerFactory.create = real;
    }
  });
});
