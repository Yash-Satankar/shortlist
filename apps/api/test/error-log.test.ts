import express from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, errorHandler } from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import { appErrors } from '../src/db/schema';
import { firstAppFrame, purgeOldErrors, recordError, sanitizeMessage } from '../src/lib/error-log';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const PASSWORD = 'correct horse battery';

beforeEach(async () => {
  await resetDb();
  await db.delete(appErrors);
});
afterAll(closeDb);

describe('error log', () => {
  it('masks emails, keys, long tokens and database URLs', () => {
    expect(sanitizeMessage('failed for priya@acme.example with sk-abcdef123456 and token ' + 'A'.repeat(40) + ' at postgres://u:p@host/db')).toBe(
      'failed for [email] with [key] and token [token] at [database url]',
    );
  });

  it('finds the first frame in our own code', () => {
    const stack = ['Error: x', String.raw`    at f (D:\x\node_modules\pg\lib\a.js:1:1)`, String.raw`    at g (D:\Job Tracker\apps\api\src\ask\search.ts:120:7)`].join('\n');
    expect(firstAppFrame(stack)).toBe('src/ask/search.ts:120');
  });

  it('an unexpected error becomes a 500 for the client and a sanitized row with the route pattern (no ids)', async () => {
    const app = express();
    app.get('/api/things/:id', () => {
      throw new Error('boom for priya@acme.example');
    });
    app.use(errorHandler(db));
    const res = await request(app).get('/api/things/3f6c7d2e-1111-2222-3333-444455556666?secret=1');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'internal', message: 'Something went wrong' } });
    await new Promise((r) => setTimeout(r, 50));
    const [row] = await db.select().from(appErrors);
    expect(row).toMatchObject({ kind: 'request', where: 'GET /api/things/:id', status: 500, message: 'boom for [email]' });
  });

  it('admins see recent errors; other users can’t', async () => {
    await createUser(db, { email: 'admin@example.com', password: PASSWORD });
    await createUser(db, { email: 'user@example.com', password: PASSWORD });
    await recordError(db, { kind: 'job', where: 'email-poll', error: new Error('IMAP timeout') });
    const app = createApp({ db });
    const login = async (email: string) => {
      const a = request.agent(app);
      await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
      return a;
    };
    const admin = await login('admin@example.com');
    const body = (await admin.get('/api/admin/errors').expect(200)).body;
    expect(body).toMatchObject({ retentionDays: 30, items: [{ kind: 'job', where: 'email-poll', message: 'IMAP timeout' }] });
    expect((await (await login('user@example.com')).get('/api/admin/errors')).status).toBe(403);
  });

  it('old entries are purged', async () => {
    await recordError(db, { kind: 'job', where: 'x', error: new Error('old') });
    await db.update(appErrors).set({ createdAt: new Date(Date.now() - 31 * 86_400_000) });
    await recordError(db, { kind: 'job', where: 'x', error: new Error('new') });
    expect(await purgeOldErrors(db)).toBe(1);
    expect((await db.select().from(appErrors)).map((r) => r.message)).toEqual(['new']);
  });
});
