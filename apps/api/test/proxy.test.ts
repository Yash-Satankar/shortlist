import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

/** Railway: one reverse proxy hop that terminates TLS and appends the client IP to X-Forwarded-For. */
describe('behind a reverse proxy (TRUST_PROXY=1)', () => {
  const db = getDb();
  const app = createApp({ db });
  app.set('trust proxy', 1);

  beforeAll(async () => {
    await resetDb();
    await createUser(db, { email: 'proxy@example.com', password: 'correct horse battery' });
  });
  afterAll(closeDb);

  it('resolves the client IP and https from the proxy headers', async () => {
    const res = await request(app).get('/api/health/request').set('X-Forwarded-For', '203.0.113.7').set('X-Forwarded-Proto', 'https');
    expect(res.body).toMatchObject({ ip: '203.0.113.7', protocol: 'https', secure: true, trustProxy: 1, forwardedFor: '203.0.113.7' });
  });

  it('ignores client-forged X-Forwarded-For entries before the proxy hop', async () => {
    // The client sends "1.2.3.4"; Railway's proxy appends the real IP. Only the last hop is trusted.
    const res = await request(app).get('/api/health/request').set('X-Forwarded-For', '1.2.3.4, 203.0.113.7').set('X-Forwarded-Proto', 'https');
    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('rate-limits failed logins per real client IP, not per proxy', async () => {
    const attempt = (ip: string) =>
      request(app).post('/api/auth/login').set('Origin', ORIGIN).set('X-Forwarded-For', ip).send({ email: 'proxy@example.com', password: 'wrong password' });
    for (let i = 0; i < 10; i++) expect((await attempt('198.51.100.1')).status).toBe(401);
    expect((await attempt('198.51.100.1')).status).toBe(429); // 11th failure from the same client
    expect((await attempt('198.51.100.2')).status).toBe(401); // another client is unaffected
  });

  it('without trust proxy the forwarded headers are ignored', async () => {
    const direct = createApp({ db });
    direct.set('trust proxy', 0);
    const res = await request(direct).get('/api/health/request').set('X-Forwarded-For', '203.0.113.7').set('X-Forwarded-Proto', 'https');
    expect(res.body.ip).not.toBe('203.0.113.7');
    expect(res.body.protocol).toBe('http');
  });
});
