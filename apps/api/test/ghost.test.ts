import { eq } from 'drizzle-orm';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { getFollowUps } from '../src/applications/follow-ups';
import { createApplication } from '../src/applications/service';
import { proposeStatus } from '../src/applications/status';
import { env } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { applications } from '../src/db/schema';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const DAY = 86_400_000;
let userId: string;
let agent: TestAgent;

/** An Applied application that has been quiet for 25 days (past the 21-day ghost threshold). */
async function quietApp(name = 'Quiet Co') {
  const { id } = (await createApplication(db, userId, { companyName: name, roleTitle: 'Dev', status: 'applied', via: 'manual', confirmDuplicate: false }, 'manual'))
    .application;
  await db.update(applications).set({ lastActivityAt: new Date(Date.now() - 25 * DAY) }).where(eq(applications.id, id));
  return id;
}

const ghostIds = async (now = new Date()) => (await getFollowUps(db, userId, now)).ghostSuggestions.map((g) => g.id);
const dismiss = (id: string, a = agent) => a.post(`/api/applications/${id}/ghost/dismiss`).set('Origin', ORIGIN);

beforeEach(async () => {
  await resetDb();
  userId = (await createUser(db, { email: 'ghost@example.com', password: 'correct horse battery' })).id;
  agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'ghost@example.com', password: 'correct horse battery' }).expect(200);
});
afterAll(closeDb);

describe('ghost suggestion "Not yet" (server-side)', () => {
  it('hides the suggestion everywhere (it is stored per application, not per device)', async () => {
    const id = await quietApp();
    expect(await ghostIds()).toEqual([id]);
    expect((await dismiss(id)).status).toBe(200);

    expect(await ghostIds()).toEqual([]);
    // A second device (new session) sees the same thing.
    const phone = request.agent(app);
    await phone.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'ghost@example.com', password: 'correct horse battery' }).expect(200);
    expect((await phone.get('/api/follow-ups')).body.ghostSuggestions).toEqual([]);
  });

  it('reappears after new activity on that application', async () => {
    const id = await quietApp();
    await dismiss(id).expect(200);
    // New activity (a forward signal) that was itself long ago, so the app is still "quiet" enough to ghost.
    await proposeStatus(db, { userId, applicationId: id, status: 'viewed', source: 'portal', occurredAt: new Date() });
    await db.update(applications).set({ lastActivityAt: new Date(Date.now() + 1000), statusChangedAt: new Date() }).where(eq(applications.id, id));
    // 25 days later the quiet period is back, and the old dismissal no longer applies.
    expect(await ghostIds(new Date(Date.now() + 25 * DAY))).toEqual([id]);
  });

  it(`reappears GHOST_SUGGEST_DAYS after dismissal even without activity (default ${env().GHOST_SUGGEST_DAYS})`, async () => {
    const id = await quietApp();
    await dismiss(id).expect(200);
    const days = env().GHOST_SUGGEST_DAYS;
    expect(await ghostIds(new Date(Date.now() + (days - 1) * DAY))).toEqual([]);
    expect(await ghostIds(new Date(Date.now() + days * DAY + 60_000))).toEqual([id]);
  });

  it('only affects the dismissed application', async () => {
    const a = await quietApp('A Co');
    const b = await quietApp('B Co');
    await dismiss(a).expect(200);
    expect(await ghostIds()).toEqual([b]);
  });

  it("cannot dismiss another user's application", async () => {
    const mine = await quietApp();
    await createUser(db, { email: 'other@example.com', password: 'correct horse battery' });
    const other = request.agent(app);
    await other.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'other@example.com', password: 'correct horse battery' }).expect(200);
    expect((await dismiss(mine, other)).status).toBe(404);
    expect(await ghostIds()).toEqual([mine]);
  });

  it('is a user action: automatic (extension auto) intent is refused', async () => {
    const id = await quietApp();
    const { token } = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token;
    const res = await request(app).post(`/api/applications/${id}/ghost/dismiss`).set('Authorization', `Bearer ${token}`).set('X-JT-Intent', 'auto');
    expect(res.status).toBe(403);
  });
});
