import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import { portalSnapshots, portalSyncItems } from '../src/db/schema';
import { purgeExpiredSnapshots } from '../src/portal/service';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';
const LIST = 'https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED';

async function login(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
  const token = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token.token as string;
  return { agent, token };
}
type Who = Awaited<ReturnType<typeof login>>;

const item = (over: Record<string, unknown> = {}) => ({ externalId: '4000000001', roleTitle: 'Backend Engineer', companyName: 'Acme', statusLabel: 'Application viewed', ...over });
const sync = (who: Who, items: unknown[], intent = 'auto') =>
  request(app).post('/api/portal-sync').set({ Authorization: `Bearer ${who.token}`, 'X-JT-Intent': intent }).send({ site: 'linkedin', pageUrl: LIST, items, verified: false });
const save = async (who: Who, body: Record<string, unknown> = {}) =>
  (await who.agent.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Acme', roleTitle: 'Backend Engineer', jobUrl: 'https://www.linkedin.com/jobs/view/4000000001/', status: 'applied', ...body }).expect(201)).body.application as { id: string };
const pending = async (who: Who) => (await who.agent.get('/api/portal-sync/pending').expect(200)).body.items as Array<Record<string, unknown> & { id: string }>;
const review = (who: Who, body: Record<string, unknown>) => who.agent.post('/api/portal-sync/review').set('Origin', ORIGIN).send(body);
const detail = async (who: Who, id: string) => (await who.agent.get(`/api/applications/${id}`).expect(200)).body.application;

let a: Who;
beforeEach(async () => {
  await resetDb();
  await createUser(db, { email: 'a@example.com', password: PASSWORD });
  await createUser(db, { email: 'b@example.com', password: PASSWORD });
  a = await login('a@example.com');
});
afterAll(closeDb);

describe('portal sync: proposals', () => {
  it('a tracked job moving forward becomes a status proposal (nothing changes yet)', async () => {
    const { id } = await save(a);
    const res = await sync(a, [item()]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ read: 1, proposed: 1, unchanged: 0, unknownLabels: [], pending: 1 });
    const [p] = await pending(a);
    expect(p).toMatchObject({ kind: 'status', matchedBy: 'url', applicationId: id, currentStatus: 'applied', proposedStatus: 'viewed', rawLabel: 'Application viewed' });
    expect((await detail(a, id)).status).toBe('applied');
  });

  it('a job you applied to but don’t track becomes a "new" proposal', async () => {
    await sync(a, [item({ externalId: '4000000009', roleTitle: 'Data Engineer', companyName: 'Globex', statusLabel: 'Applied' })]);
    expect(await pending(a)).toEqual([expect.objectContaining({ kind: 'new', applicationId: null, proposedStatus: 'applied', companyName: 'Globex' })]);
  });

  it('no change, backwards moves, closed jobs and unknown labels are not proposed', async () => {
    await save(a, { status: 'interview' });
    const res = await sync(a, [
      item({ statusLabel: 'Application viewed' }), // backwards from interview
      item({ externalId: '4000000002', roleTitle: 'Other', companyName: 'Initech', statusLabel: 'No longer accepting applications' }),
      item({ externalId: '4000000003', roleTitle: 'Third', companyName: 'Hooli', statusLabel: 'Hiring team is reviewing' }),
    ]);
    expect(res.body).toMatchObject({ proposed: 0, unchanged: 1, informational: 1, unknownLabels: ['Hiring team is reviewing'] });
    expect(await pending(a)).toHaveLength(0);
  });

  it('idempotent: syncing the same list again adds nothing', async () => {
    await save(a);
    await sync(a, [item()]);
    const again = await sync(a, [item()]);
    expect(again.body).toMatchObject({ proposed: 0, pending: 1 });
  });

  it('a newer status replaces an older pending proposal for the same job', async () => {
    await save(a);
    await sync(a, [item({ statusLabel: 'Application viewed' })]);
    await sync(a, [item({ statusLabel: 'No longer under consideration' })]);
    const items = await pending(a);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ proposedStatus: 'rejected' });
  });

  it('the read is stored encrypted and expires', async () => {
    await sync(a, [item()]);
    const [raw] = (await db.execute(sql`select items_enc, expires_at from portal_snapshots`)).rows as { items_enc: string; expires_at: Date }[];
    expect(raw!.items_enc).toMatch(/^v1\./);
    expect(raw!.items_enc).not.toContain('Backend Engineer');
    expect(new Date(raw!.expires_at).getTime() - Date.now()).toBeGreaterThan(89 * 86_400_000);
    await db.update(portalSnapshots).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await purgeExpiredSnapshots(db)).toBe(1);
    // The proposal stays reviewable without its snapshot.
    const [p] = await db.select().from(portalSyncItems);
    expect(p).toMatchObject({ snapshotId: null, decision: 'pending' });
  });
});

describe('portal sync: review', () => {
  it('accepting applies through the rules as source "portal", raw label as the only evidence; undoable', async () => {
    const { id } = await save(a);
    await sync(a, [item()]);
    const [p] = await pending(a);
    const res = await review(a, { accept: [p!.id] });
    expect(res.body.results).toEqual([{ id: p!.id, outcome: 'applied', applicationId: id }]);
    const d = await detail(a, id);
    expect(d.status).toBe('viewed');
    const ev = d.timeline.at(-1);
    expect(ev).toMatchObject({ source: 'portal', disposition: 'applied', note: 'LinkedIn: "Application viewed"', evidenceType: 'portal_snapshot', confidenceScore: 0.9 });
    expect(await pending(a)).toHaveLength(0);
    const undo = await a.agent.post(`/api/applications/${id}/events/${ev.id}/undo`).set('Origin', ORIGIN).send({});
    expect(undo.body.application.status).toBe('applied');
  });

  it('accepting a "new" proposal saves the job, then moves it like any other change', async () => {
    await sync(a, [item({ externalId: '4000000009', roleTitle: 'Data Engineer', companyName: 'Globex', statusLabel: 'Applied' })]);
    const [p] = await pending(a);
    const res = await review(a, { accept: [p!.id] });
    expect(res.body.results[0]).toMatchObject({ outcome: 'created' });
    const d = await detail(a, res.body.results[0].applicationId);
    expect(d).toMatchObject({ status: 'applied', roleTitle: 'Data Engineer', jobUrl: 'https://www.linkedin.com/jobs/view/4000000009/' });
    expect(d.timeline.map((e: { toStatus: string; source: string }) => `${e.toStatus}:${e.source}`)).toEqual(['saved:portal', 'applied:portal']);
  });

  it('a job in a final state is never reopened by a portal status: nothing is proposed', async () => {
    const { id } = await save(a, { status: 'rejected' });
    const res = await sync(a, [item({ statusLabel: 'Application viewed' })]);
    expect(res.body).toMatchObject({ proposed: 0, unchanged: 1 });
    expect(await pending(a)).toHaveLength(0);
    expect((await detail(a, id)).status).toBe('rejected');
  });

  it('dismissed proposals are not proposed again', async () => {
    await save(a);
    await sync(a, [item()]);
    const [p] = await pending(a);
    await review(a, { dismiss: [p!.id] }).expect(200);
    const again = await sync(a, [item()]);
    expect(again.body.proposed).toBe(0);
    expect(await pending(a)).toHaveLength(0);
  });

  it('review is a user action: the extension’s automatic intent can’t accept', async () => {
    await save(a);
    await sync(a, [item()]);
    const [p] = await pending(a);
    const res = await request(app).post('/api/portal-sync/review').set({ Authorization: `Bearer ${a.token}`, 'X-JT-Intent': 'auto' }).send({ accept: [p!.id] });
    expect(res.status).toBe(403);
  });

  it('inbox count includes proposals', async () => {
    await save(a);
    await sync(a, [item()]);
    const stats = (await a.agent.get('/api/stats').expect(200)).body;
    expect(stats.needsYou).toMatchObject({ portalSync: 1 });
    expect(stats.needsYou.total).toBeGreaterThanOrEqual(1);
  });
});

describe('portal sync: switches and isolation', () => {
  it('respects the portal sync feature switch (and the extension it needs)', async () => {
    await a.agent.patch('/api/features').set('Origin', ORIGIN).send({ portal_sync: false }).expect(200);
    const res = await sync(a, [item()], 'user');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('feature_disabled');
  });

  it('cross-user: proposals, reviews and matches are per user', async () => {
    const { id } = await save(a);
    const b = await login('b@example.com');
    await sync(b, [item()]); // B doesn't track this job: a "new" proposal for B only
    expect(await pending(a)).toHaveLength(0);
    const [bp] = await pending(b);
    expect(bp).toMatchObject({ kind: 'new', applicationId: null });
    // A can't review B's proposal
    const res = await review(a, { accept: [bp!.id] });
    expect(res.body).toMatchObject({ results: [], notFound: 1 });
    expect((await detail(a, id)).status).toBe('applied');
    expect((await db.select().from(portalSyncItems).where(eq(portalSyncItems.id, bp!.id)))[0]!.decision).toBe('pending');
  });
});
