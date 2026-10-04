import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import { profiles } from '../src/db/schema';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const EMAIL = 'Asha@Example.com';
const PASSWORD = 'correct horse battery';

async function login(agent = request.agent(app)) {
  const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: EMAIL, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(async () => {
  await resetDb();
  await createUser(db, { email: EMAIL, password: PASSWORD, name: 'Asha' });
});

afterAll(closeDb);

describe('session auth', () => {
  it('logs in (case-insensitive email), sets an httpOnly cookie, and resolves /me', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'asha@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^jt_sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('asha@example.com');
    expect(me.body.user.settings.ghostAfterDays).toBe(21);
  });

  it('stores only the hash of the session token', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: EMAIL, password: PASSWORD });
    const token = /jt_sid=([^;]+)/.exec(res.headers['set-cookie']![0]!)![1]!;
    const rows = await db.execute(sql`select token_hash from sessions`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.token_hash).not.toBe(token);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: EMAIL, password: 'wrong password' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('rejects unknown emails the same way', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'nobody@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('logout invalidates the session server-side', async () => {
    const agent = await login();
    expect((await agent.post('/api/auth/logout').set('Origin', ORIGIN)).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('requires auth for /me', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('validates the login payload', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('keeps sign-up disabled by default', async () => {
    const res = await request(app).post('/api/auth/signup').set('Origin', ORIGIN).send({ email: 'new@example.com', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('creates a profile row with the user', async () => {
    const rows = await db.select().from(profiles);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fullName).toBe('Asha');
  });
});

describe('password change', () => {
  const NEW_PASSWORD = 'a brand new passphrase';

  it('requires the current password', async () => {
    const agent = await login();
    const res = await agent
      .post('/api/auth/password')
      .set('Origin', ORIGIN)
      .send({ currentPassword: 'wrong password', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  it('enforces the minimum length', async () => {
    const agent = await login();
    const res = await agent.post('/api/auth/password').set('Origin', ORIGIN).send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('changes the password, keeps this session and signs out the others', async () => {
    const other = await login();
    const agent = await login();
    const res = await agent.post('/api/auth/password').set('Origin', ORIGIN).send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await other.get('/api/auth/me')).status).toBe(401);

    const oldLogin = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: EMAIL, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: EMAIL, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
  });

  it('cannot be done with an API token', async () => {
    const agent = await login();
    const { token } = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token;
    const res = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe('signed-in devices (sliding, revocable sessions)', () => {
  it('slides the expiry forward on use, to SESSION_TTL_DAYS from now', async () => {
    const agent = await login();
    // Pretend the session was last used 2 days ago and expires in 28.
    await db.execute(sql`update sessions set last_seen_at = now() - interval '2 days', expires_at = now() + interval '28 days'`);
    await agent.get('/api/auth/me').expect(200);
    const [row] = (await db.execute<{ days: number }>(sql`select extract(epoch from expires_at - now()) / 86400 as days from sessions`)).rows;
    expect(Number(row!.days)).toBeGreaterThan(29.9);
  });

  it('lists devices, marking the current one, and revokes another device', async () => {
    const phone = await login();
    const laptop = await login();
    const { sessions } = (await laptop.get('/api/auth/sessions').expect(200)).body;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const other = sessions.find((s: { current: boolean }) => !s.current);
    await laptop.delete(`/api/auth/sessions/${other.id}`).set('Origin', ORIGIN).expect(204);
    expect((await phone.get('/api/auth/me')).status).toBe(401);
    expect((await laptop.get('/api/auth/me')).status).toBe(200);
  });

  it('"sign out other devices" keeps only the current session', async () => {
    const a = await login();
    const b = await login();
    const c = await login();
    expect((await c.post('/api/auth/sessions/revoke-others').set('Origin', ORIGIN)).body).toEqual({ revoked: 2 });
    expect((await a.get('/api/auth/me')).status).toBe(401);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it("cannot revoke another user's session", async () => {
    await createUser(db, { email: 'other@example.com', password: PASSWORD });
    const other = request.agent(app);
    await other.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'other@example.com', password: PASSWORD }).expect(200);
    const otherSessionId = (await other.get('/api/auth/sessions')).body.sessions[0].id;

    const mine = await login();
    expect((await mine.delete(`/api/auth/sessions/${otherSessionId}`).set('Origin', ORIGIN)).status).toBe(404);
    expect((await other.get('/api/auth/me')).status).toBe(200);
  });
});

describe('CSRF / same-origin guard', () => {
  it('blocks cookie-authenticated writes from another origin', async () => {
    const agent = await login();
    const res = await agent.post('/api/auth/logout').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('blocks writes with neither Origin nor same-origin fetch metadata', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('accepts Sec-Fetch-Site: same-origin when Origin is absent', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe('extension pairing: a token can revoke itself (Disconnect)', () => {
  it('revokes only the calling token; others keep working', async () => {
    const agent = await login();
    const a = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'Chrome on Windows' })).body.token;
    const b = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'Edge on Windows' })).body.token;

    expect((await request(app).post('/api/auth/tokens/self/revoke').set('Authorization', `Bearer ${a.token}`)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${a.token}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${b.token}`)).status).toBe(200);

    const list = (await agent.get('/api/auth/tokens')).body.tokens;
    expect(list.find((t: { id: string }) => t.id === a.id).revokedAt).not.toBeNull();
    expect(list.find((t: { id: string }) => t.id === b.id)).toMatchObject({ name: 'Edge on Windows', revokedAt: null });
  });

  it('a browser session cannot use it', async () => {
    const agent = await login();
    expect((await agent.post('/api/auth/tokens/self/revoke').set('Origin', ORIGIN)).status).toBe(403);
  });

  it("one user's token never affects another user's tokens", async () => {
    const agent = await login();
    const mine = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'mine' })).body.token;
    await createUser(db, { email: 'other@example.com', password: PASSWORD });
    const other = request.agent(app);
    await other.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'other@example.com', password: PASSWORD }).expect(200);
    const theirs = (await other.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'theirs' })).body.token;

    await request(app).post('/api/auth/tokens/self/revoke').set('Authorization', `Bearer ${theirs.token}`).expect(204);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${mine.token}`)).status).toBe(200);
    expect((await other.get('/api/auth/tokens')).body.tokens.map((t: { name: string }) => t.name)).toEqual(['theirs']);
  });
});

describe('API tokens (extension)', () => {
  it('creates a token once, authenticates with it, and stops working after revoke', async () => {
    const agent = await login();
    const created = await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'Chrome laptop' });
    expect(created.status).toBe(201);
    const { token, id } = created.body.token;
    expect(token).toMatch(/^jt_/);

    const list = await agent.get('/api/auth/tokens');
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token);

    // Bearer requests need no Origin (no ambient credentials → no CSRF risk).
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.auth.via).toBe('token');

    expect((await agent.delete(`/api/auth/tokens/${id}`).set('Origin', ORIGIN)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('does not let a bearer token mint more tokens', async () => {
    const agent = await login();
    const { token } = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token;
    const res = await request(app).post('/api/auth/tokens').set('Authorization', `Bearer ${token}`).send({ name: 'x' });
    expect(res.status).toBe(403);
  });

  it('rejects garbage bearer tokens', async () => {
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer jt_nope')).status).toBe(401);
  });

  it('cannot revoke another user’s token', async () => {
    const other = await createUser(db, { email: 'other@example.com', password: PASSWORD });
    const otherAgent = request.agent(app);
    await otherAgent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'other@example.com', password: PASSWORD });
    const { id } = (await otherAgent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'theirs' })).body.token;

    const agent = await login();
    expect((await agent.delete(`/api/auth/tokens/${id}`).set('Origin', ORIGIN)).status).toBe(404);
    expect(other.id).toBeTruthy();
  });
});

describe('encrypted columns', () => {
  it('stores CTC encrypted at rest and decrypts on read', async () => {
    const [user] = await db.execute<{ id: string }>(sql`select id from users limit 1`).then((r) => r.rows);
    await db.update(profiles).set({ currentCtcEnc: '5 LPA' }).where(eq(profiles.userId, user!.id));

    const raw = await db.execute<{ current_ctc_enc: string }>(sql`select current_ctc_enc from profiles`);
    expect(raw.rows[0]!.current_ctc_enc).toMatch(/^v1\./);
    expect(raw.rows[0]!.current_ctc_enc).not.toContain('5 LPA');

    const [profile] = await db.select().from(profiles);
    expect(profile!.currentCtcEnc).toBe('5 LPA');
  });
});

describe('health', () => {
  it('reports ok when the DB is reachable', async () => {
    expect((await request(app).get('/api/health')).body).toEqual({ ok: true });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('public config', () => {
  it('exposes only the session length, without signing in', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionTtlDays: 30 });
  });
});
