import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import { statusEvents } from '../src/db/schema';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';
const URL_A = 'https://job-boards.greenhouse.io/acme/jobs/7000001';

async function login(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
  const token = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token.token as string;
  return { agent, token };
}
type Who = Awaited<ReturnType<typeof login>>;

const detect = (who: Who, body: Record<string, unknown>, intent = 'auto') =>
  request(app)
    .post('/api/applications/detected-submission')
    .set({ Authorization: `Bearer ${who.token}`, 'X-JT-Intent': intent })
    .send({ site: 'greenhouse', jobUrl: URL_A, signal: 'confirmation page', verified: true, ...body });

const save = async (who: Who, body: Record<string, unknown> = {}) =>
  (await who.agent.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Acme', roleTitle: 'Backend Engineer', jobUrl: URL_A, status: 'saved', ...body }).expect(201)).body.application as { id: string };
const detail = async (who: Who, id: string) => (await who.agent.get(`/api/applications/${id}`).expect(200)).body.application;
const eventCount = async (id: string) => (await db.select().from(statusEvents).where(eq(statusEvents.applicationId, id))).length;

let a: Who;
beforeEach(async () => {
  await resetDb();
  await createUser(db, { email: 'a@example.com', password: PASSWORD });
  await createUser(db, { email: 'b@example.com', password: PASSWORD });
  a = await login('a@example.com');
});
afterAll(closeDb);

describe('detected submission', () => {
  it('verified detector + tracked job → Applied, on the timeline with source, score and note, undoable', async () => {
    const { id } = await save(a);
    const res = await detect(a, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applicationId: id, created: false, matchedBy: 'url', duplicate: false, event: { disposition: 'applied', reason: 'forward' } });
    const d = await detail(a, id);
    expect(d.status).toBe('applied');
    expect(d.timeline.at(-1)).toMatchObject({ source: 'extension_auto', confidence: 'high', confidenceScore: 0.95 });
    expect(d.timeline.at(-1).note).toMatch(/Submitted page detected on greenhouse/);
    // In-page Undo = a user action on that event.
    const undo = await request(app).post(`/api/applications/${id}/events/${res.body.event.id}/undo`).set({ Authorization: `Bearer ${a.token}`, 'X-JT-Intent': 'user' }).send({});
    expect(undo.status).toBe(200);
    expect(undo.body.application.status).toBe('saved');
    // Undo from the extension is recorded as the extension (a user click, manual rules).
    expect(undo.body.application.timeline.at(-1)).toMatchObject({ toStatus: 'saved', source: 'extension', confidenceScore: null });
  });

  it('unverified detector → waits in Follow-ups (pending review); the status does not change', async () => {
    const { id } = await save(a);
    const res = await detect(a, { verified: false });
    expect(res.body.event).toMatchObject({ disposition: 'pending_review', reason: 'low_confidence' });
    expect((await detail(a, id)).status).toBe('saved');
    const reviews = (await a.agent.get('/api/reviews').expect(200)).body;
    expect(JSON.stringify(reviews)).toContain(res.body.event.id);
  });

  it('idempotent: a reload or revisit records nothing new', async () => {
    const { id } = await save(a);
    await detect(a, {}).expect(200);
    const before = await eventCount(id);
    const again = await detect(a, {});
    const third = await detect(a, { signal: 'revisited' });
    expect(again.body).toMatchObject({ duplicate: true, created: false });
    expect(third.body.duplicate).toBe(true);
    expect(await eventCount(id)).toBe(before);
  });

  it('already Applied by hand: noted once (ignored), never twice', async () => {
    const { id } = await save(a, { status: 'applied' });
    const first = await detect(a, {});
    expect(first.body.event).toMatchObject({ disposition: 'ignored', reason: 'no_change' });
    const n = await eventCount(id);
    expect((await detect(a, {})).body.duplicate).toBe(true);
    expect(await eventCount(id)).toBe(n);
  });

  it('not tracked yet, with role + company → saved and marked Applied (Undo can delete it)', async () => {
    const res = await detect(a, { roleTitle: 'Platform Engineer', companyName: 'Globex', jd: 'Run the platform.' });
    expect(res.body).toMatchObject({ created: true, event: { disposition: 'applied' } });
    const d = await detail(a, res.body.applicationId);
    expect(d).toMatchObject({ status: 'applied', roleTitle: 'Platform Engineer' });
    expect(d.timeline.map((e: { toStatus: string; source: string }) => `${e.toStatus}:${e.source}`)).toEqual(['saved:extension_auto', 'applied:extension_auto']);
    const del = await request(app).delete(`/api/applications/${res.body.applicationId}`).set({ Authorization: `Bearer ${a.token}`, 'X-JT-Intent': 'user' });
    expect(del.status).toBe(204);
  });

  it('not tracked and the page had no role/company → nothing saved, the popup offers to save', async () => {
    const res = await detect(a, {});
    expect(res.body).toMatchObject({ applicationId: null, needsDetails: true, event: null });
    expect((await a.agent.get('/api/applications')).body.items).toHaveLength(0);
  });

  it('matched only by company + role (different link) → always asks, even from a verified detector', async () => {
    const { id } = await save(a, { jobUrl: 'https://www.linkedin.com/jobs/view/4000000001/' });
    const res = await detect(a, { roleTitle: 'Backend Engineer', companyName: 'Acme' });
    expect(res.body).toMatchObject({ applicationId: id, matchedBy: 'company_role', event: { disposition: 'pending_review' } });
    expect((await detail(a, id)).status).toBe('saved');
  });

  it('only as an automatic signal from the extension', async () => {
    await save(a);
    expect((await detect(a, {}, 'user')).status).toBe(403);
    expect((await a.agent.post('/api/applications/detected-submission').set('Origin', ORIGIN).send({ site: 'greenhouse', jobUrl: URL_A, signal: 'x', verified: true })).status).toBe(403);
  });

  it('respects the extension switch', async () => {
    await save(a);
    await a.agent.patch('/api/features').set('Origin', ORIGIN).send({ extension: false }).expect(200);
    const res = await detect(a, {});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('feature_disabled');
  });

  it('cross-user: another user’s detection never touches my application', async () => {
    const { id } = await save(a);
    const b = await login('b@example.com');
    const res = await detect(b, { roleTitle: 'Backend Engineer', companyName: 'Acme' });
    expect(res.body.applicationId).not.toBe(id);
    expect((await detail(a, id)).status).toBe('saved');
    const mine = await db.select().from(statusEvents).where(and(eq(statusEvents.applicationId, id), eq(statusEvents.source, 'extension_auto')));
    expect(mine).toHaveLength(0);
  });
});
