import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { proposeStatus } from '../src/applications/status';
import { closeDb, getDb } from '../src/db/client';
import { applications } from '../src/db/schema';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';

let agent: TestAgent;
let userId: string;

async function signIn(email: string) {
  const a = request.agent(app);
  await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
  return a;
}

const post = (path: string, body: object) => agent.post(path).set('Origin', ORIGIN).send(body);

async function create(body: Record<string, unknown>) {
  const res = await post('/api/applications', { companyName: 'Acme', roleTitle: 'Backend Developer', ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.application as { id: string; status: string; timeline: Array<{ id: string; toStatus: string; disposition: string; source: string }> };
}

/** Simulates an automatic source (email/portal) via the same service the importers will use. */
const automatic = (
  applicationId: string,
  status: Parameters<typeof proposeStatus>[1]['status'],
  source: 'email' | 'portal' | 'extension_auto' = 'email',
  confidence?: 'high' | 'low',
) => proposeStatus(db, { userId, applicationId, status, source, confidence });

const detail = async (id: string) => (await agent.get(`/api/applications/${id}`).expect(200)).body.application;

beforeEach(async () => {
  await resetDb();
  userId = (await createUser(db, { email: 'asha@example.com', password: PASSWORD })).id;
  agent = await signIn('asha@example.com');
});

afterAll(closeDb);

describe('create', () => {
  it('creates an application with company, JD snapshot, Q&A and a first timeline event', async () => {
    const created = await create({
      companyName: 'Contoso India Pvt Ltd',
      roleTitle: 'Node.js Developer',
      location: 'Hyderabad',
      workMode: 'onsite',
      jobUrl: 'https://in.linkedin.com/jobs/view/4100000101/?trk=abc',
      status: 'applied',
      appliedOn: '2026-09-29',
      expectedCtc: '12 LPA',
      jd: 'Lead Node.js developer. AWS required.',
      answers: [{ question: 'Years of AWS', answer: '0' }],
    });

    const app = await detail(created.id);
    expect(app.company.name).toBe('Contoso India Pvt Ltd');
    expect(app.source).toBe('linkedin'); // inferred from URL
    expect(app.externalJobId).toBe('4100000101');
    expect(app.jobUrlCanonical).toBe('https://www.linkedin.com/jobs/view/4100000101/');
    expect(app.appliedOn).toBe('2026-09-29');
    expect(app.expectedCtc).toBe('12 LPA');
    expect(app.jd.content).toContain('AWS required');
    expect(app.answers).toEqual([expect.objectContaining({ question: 'Years of AWS', answer: '0' })]);
    expect(app.timeline).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'applied', source: 'manual', disposition: 'applied' })]);
  });

  it('encrypts expected CTC at rest', async () => {
    await create({ expectedCtc: '12 LPA' });
    const raw = await db.execute<{ expected_ctc_enc: string }>(sql`select expected_ctc_enc from applications`);
    expect(raw.rows[0]!.expected_ctc_enc).toMatch(/^v1\./);
  });

  it('defaults appliedOn to today when created as Applied', async () => {
    const created = await create({ status: 'applied' });
    expect((await detail(created.id)).appliedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('records share-sheet captures with source "share"', async () => {
    const created = await create({ via: 'share' });
    expect(created.timeline[0]!.source).toBe('share');
  });

  it('validates input', async () => {
    const res = await post('/api/applications', { companyName: '', roleTitle: 'x', jobUrl: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
  });
});

describe('duplicate detection', () => {
  it('blocks the exact same posting (canonical URL), even with different tracking params', async () => {
    await create({ jobUrl: 'https://www.linkedin.com/jobs/view/4100000101/' });
    const res = await post('/api/applications', {
      companyName: 'Someone Else',
      roleTitle: 'Other',
      jobUrl: 'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4100000101',
      confirmDuplicate: true,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('duplicate_exact');
  });

  it('warns on a likely duplicate and saves after confirmation', async () => {
    await create({ companyName: 'Acme Technologies Pvt Ltd', roleTitle: 'Full Stack Engineer' });
    const warn = await post('/api/applications', { companyName: 'ACME', roleTitle: 'Full-Stack Engineer' });
    expect(warn.status).toBe(409);
    expect(warn.body.error.code).toBe('duplicate_likely');
    expect(warn.body.error.details.matches[0].roleTitle).toBe('Full Stack Engineer');

    const confirmed = await post('/api/applications', { companyName: 'ACME', roleTitle: 'Full-Stack Engineer', confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
  });

  it('Lumen Browser: two different roles save without a warning, only a hint', async () => {
    await create({ companyName: 'Lumen Browser', roleTitle: 'Backend Platform Engineer', location: 'Hyderabad' });
    const res = await post('/api/applications', { companyName: 'Lumen Browser', roleTitle: 'Full-Stack Engineer', location: 'Hyderabad' });
    expect(res.status).toBe(201);
    expect(res.body.hints).toEqual([expect.objectContaining({ roleTitle: 'Backend Platform Engineer', level: 'hint' })]);
  });

  it('Northwind Data: two different roles save without a warning, only a hint', async () => {
    await create({ companyName: 'Northwind Data', roleTitle: 'Full-Stack Engineer (Node/TS/AWS)' });
    const res = await post('/api/applications', { companyName: 'Northwind Data', roleTitle: 'Senior Software Engineer (Node.js & TypeScript)' });
    expect(res.status).toBe(201);
    expect(res.body.hints.map((h: { level: string }) => h.level)).toEqual(['hint']);
  });

  it('check-duplicates previews without saving', async () => {
    await create({ companyName: 'Lumen Browser', roleTitle: 'Backend Platform Engineer' });
    const res = await post('/api/applications/check-duplicates', { companyName: 'Lumen Browser Pvt Ltd', roleTitle: 'Backend Platform Engineer' });
    expect(res.body.matches.map((m: { level: string }) => m.level)).toEqual(['likely']);
    expect((await agent.get('/api/applications')).body.total).toBe(1);
  });
});

describe('status rules (end to end)', () => {
  it('an "Applied" email arriving after Interview is ignored but visible on the timeline', async () => {
    const { id } = await create({ status: 'applied' });
    await post(`/api/applications/${id}/status`, { status: 'interview' }).expect(200);

    const { decision } = await automatic(id, 'applied');
    expect(decision).toEqual({ disposition: 'ignored', reason: 'backwards' });

    const app = await detail(id);
    expect(app.status).toBe('interview');
    expect(app.timeline.at(-1)).toMatchObject({ toStatus: 'applied', source: 'email', disposition: 'ignored', reason: 'backwards' });
  });

  it.each(['offer', 'rejected', 'withdrawn'] as const)('%s is never changed automatically, only flagged for review', async (locked) => {
    const { id } = await create({ status: 'applied' });
    await post(`/api/applications/${id}/status`, { status: locked }).expect(200);

    for (const proposed of ['interview', 'shortlisted', 'offer', 'rejected'] as const) {
      if (proposed !== locked) await automatic(id, proposed, 'portal');
    }
    const app = await detail(id);
    expect(app.status).toBe(locked);
    const flagged = app.timeline.filter((e: { source: string }) => e.source === 'portal');
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((e: { disposition: string }) => e.disposition === 'pending_review')).toBe(true);

    const reviews = await agent.get('/api/reviews').expect(200);
    expect(reviews.body.items).toHaveLength(flagged.length);
  });

  it('a flagged change can be accepted (applies) or dismissed (no change)', async () => {
    const { id } = await create({ status: 'applied' });
    await post(`/api/applications/${id}/status`, { status: 'rejected' }).expect(200);
    const { event: first } = await automatic(id, 'interview');
    const { event: second } = await automatic(id, 'assessment');

    await post(`/api/applications/${id}/events/${second!.id}/review`, { decision: 'dismiss' }).expect(200);
    let app = await detail(id);
    expect(app.status).toBe('rejected');

    await post(`/api/applications/${id}/events/${first!.id}/review`, { decision: 'accept' }).expect(200);
    app = await detail(id);
    expect(app.status).toBe('interview');
    expect(app.timeline.find((e: { id: string }) => e.id === first!.id)).toMatchObject({ disposition: 'applied', fromStatus: 'rejected' });
    expect(app.timeline.find((e: { id: string }) => e.id === second!.id).disposition).toBe('dismissed');
    expect((await agent.get('/api/reviews')).body.items).toHaveLength(0);
  });

  it('applies forward automatic changes', async () => {
    const { id } = await create({ status: 'applied' });
    await automatic(id, 'assessment');
    expect((await detail(id)).status).toBe('assessment');
  });
});

describe('final-state rules (end to end)', () => {
  it('INTO Rejected from a high-confidence automatic signal applies, is on the timeline, and is undoable', async () => {
    const { id } = await create({ status: 'interview' });
    const { decision, event } = await automatic(id, 'rejected', 'portal', 'high');
    expect(decision).toEqual({ disposition: 'applied', reason: 'rejection' });

    let app = await detail(id);
    expect(app.status).toBe('rejected');
    expect(app.timeline.at(-1)).toMatchObject({ source: 'portal', disposition: 'applied', reason: 'rejection', confidence: 'high' });

    app = (await post(`/api/applications/${id}/events/${event!.id}/undo`, {}).expect(200)).body.application;
    expect(app.status).toBe('interview');
  });

  it('INTO Rejected from a low-confidence (or unspecified) signal waits for review', async () => {
    const { id } = await create({ status: 'interview' });
    expect((await automatic(id, 'rejected', 'email', 'low')).decision.reason).toBe('low_confidence');
    expect((await automatic(id, 'rejected', 'email')).decision.reason).toBe('low_confidence');
    const app = await detail(id);
    expect(app.status).toBe('interview');
    expect(app.timeline.at(-1)).toMatchObject({ disposition: 'pending_review', confidence: 'low' });
  });

  it('INTO Offer from any automatic source always waits for review, even at high confidence', async () => {
    const { id } = await create({ status: 'interview' });
    for (const source of ['email', 'portal', 'extension_auto'] as const) {
      const { decision } = await automatic(id, 'offer', source, 'high');
      expect(decision).toEqual({ disposition: 'pending_review', reason: 'offer_needs_review' });
    }
    expect((await detail(id)).status).toBe('interview');
    expect((await agent.get('/api/reviews')).body.items).toHaveLength(3);
  });

  it('LEAVING Offer / Rejected / Withdrawn automatically always waits for review', async () => {
    for (const locked of ['offer', 'rejected', 'withdrawn'] as const) {
      const { id } = await create({ companyName: `Co ${locked}`, status: locked });
      const { decision } = await automatic(id, 'interview', 'portal', 'high');
      expect(decision).toEqual({ disposition: 'pending_review', reason: 'locked' });
      expect((await detail(id)).status).toBe(locked);
    }
  });
});

describe('extension intent', () => {
  let token: string;
  beforeEach(async () => {
    token = (await post('/api/auth/tokens', { name: 'chrome' })).body.token.token;
  });
  const ext = (method: 'post' | 'patch' | 'put', path: string, intent?: string) => {
    const r = request(app)[method](path).set('Authorization', `Bearer ${token}`);
    return intent ? r.set('X-JT-Intent', intent) : r;
  };

  it('requires the extension to declare intent', async () => {
    const { id } = await create({ status: 'applied' });
    const res = await ext('post', `/api/applications/${id}/status`).send({ status: 'interview' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/X-JT-Intent/i);
    expect((await ext('post', `/api/applications/${id}/status`, 'maybe').send({ status: 'interview' })).status).toBe(400);
  });

  it('user intent (popup click) → source "extension", manual rules', async () => {
    const { id } = await create({ status: 'rejected' });
    const res = await ext('post', `/api/applications/${id}/status`, 'user').send({ status: 'interview' });
    expect(res.body.decision).toEqual({ disposition: 'applied', reason: 'user_action' });
    expect(res.body.application.timeline.at(-1)).toMatchObject({ source: 'extension', confidence: null });
  });

  it('auto intent (page detection) → source "extension_auto", automatic rules incl. confidence', async () => {
    const { id } = await create({ status: 'interview' });
    const back = await ext('post', `/api/applications/${id}/status`, 'auto').send({ status: 'applied' });
    expect(back.body.decision.disposition).toBe('ignored');
    expect(back.body.application.timeline.at(-1)).toMatchObject({ source: 'extension_auto', disposition: 'ignored' });

    const rejected = await ext('post', `/api/applications/${id}/status`, 'auto').send({ status: 'rejected', confidence: 'high' });
    expect(rejected.body.decision.reason).toBe('rejection');
  });

  it('one-click save is a user action; auto-capture of a submitted page is automatic', async () => {
    const saved = await ext('post', '/api/applications', 'user').send({ companyName: 'Clicked', roleTitle: 'Dev' });
    expect(saved.body.application.timeline[0]).toMatchObject({ source: 'extension', reason: 'user_action' });
    const detected = await ext('post', '/api/applications', 'auto').send({ companyName: 'Detected', roleTitle: 'Dev', status: 'applied' });
    expect(detected.body.application.timeline[0]).toMatchObject({ source: 'extension_auto', reason: 'forward' });
  });

  it('pure edit endpoints refuse automatic intent', async () => {
    const { id, timeline } = await create({ status: 'applied' });
    expect((await ext('patch', `/api/applications/${id}`, 'auto').send({ notes: 'x' })).status).toBe(403);
    expect((await ext('put', `/api/applications/${id}/answers`, 'auto').send({ answers: [] })).status).toBe(403);
    expect((await ext('post', `/api/applications/${id}/events/${timeline[0]!.id}/undo`, 'auto')).status).toBe(403);
    expect((await ext('post', '/api/answer-library', 'auto').send({ question: 'q', answer: 'a' })).status).toBe(403);
    expect((await ext('patch', `/api/applications/${id}`, 'user').send({ notes: 'x' })).status).toBe(200);
  });

  it('the web app cannot send automatic signals', async () => {
    const { id } = await create({ status: 'applied' });
    const res = await agent
      .post(`/api/applications/${id}/status`)
      .set('Origin', ORIGIN)
      .set('X-JT-Intent', 'auto')
      .send({ status: 'interview' });
    expect(res.status).toBe(400);
  });

  it('confidence is ignored for user actions', async () => {
    const { id } = await create({ status: 'applied' });
    const res = await post(`/api/applications/${id}/status`, { status: 'rejected', confidence: 'low' });
    expect(res.body.decision.reason).toBe('user_action');
    expect(res.body.application.status).toBe('rejected');
  });
});

describe('undo', () => {
  it('undo restores the previous status; undo of the undo restores the original', async () => {
    const { id } = await create({ status: 'applied' });
    await post(`/api/applications/${id}/status`, { status: 'interview' }).expect(200);
    let app = await detail(id);
    const change = app.timeline.at(-1);

    app = (await post(`/api/applications/${id}/events/${change.id}/undo`, {}).expect(200)).body.application;
    expect(app.status).toBe('applied');
    const undo = app.timeline.at(-1);
    expect(undo).toMatchObject({ fromStatus: 'interview', toStatus: 'applied', revertsEventId: change.id });
    expect(app.timeline.find((e: { id: string }) => e.id === change.id).revertedAt).not.toBeNull();

    app = (await post(`/api/applications/${id}/events/${undo.id}/undo`, {}).expect(200)).body.application;
    expect(app.status).toBe('interview');
    expect(app.timeline.at(-1)).toMatchObject({ fromStatus: 'applied', toStatus: 'interview', revertsEventId: undo.id });
    // Nothing was deleted: create, change, undo, redo.
    expect(app.timeline).toHaveLength(4);
  });

  it('undoes an automatic change', async () => {
    const { id } = await create({ status: 'applied' });
    const { event } = await automatic(id, 'shortlisted');
    const app = (await post(`/api/applications/${id}/events/${event!.id}/undo`, {}).expect(200)).body.application;
    expect(app.status).toBe('applied');
  });

  it('only the most recent change can be undone', async () => {
    const { id } = await create({ status: 'applied' });
    await post(`/api/applications/${id}/status`, { status: 'assessment' });
    await post(`/api/applications/${id}/status`, { status: 'interview' });
    const app = await detail(id);
    const older = app.timeline[1];
    expect((await post(`/api/applications/${id}/events/${older.id}/undo`, {})).status).toBe(409);
  });

  it('ignored and flagged events cannot be undone (they changed nothing)', async () => {
    const { id } = await create({ status: 'interview' });
    const { event } = await automatic(id, 'applied');
    expect((await post(`/api/applications/${id}/events/${event!.id}/undo`, {})).status).toBe(409);
  });

  it('the first event cannot be undone', async () => {
    const created = await create({ status: 'applied' });
    expect((await post(`/api/applications/${created.id}/events/${created.timeline[0]!.id}/undo`, {})).status).toBe(409);
  });

  it('timeline events can be edited (note, date)', async () => {
    const { id, timeline } = await create({ status: 'applied' });
    const res = await agent
      .patch(`/api/applications/${id}/events/${timeline[0]!.id}`)
      .set('Origin', ORIGIN)
      .send({ note: 'Applied via referral', occurredAt: '2026-09-20T10:00:00+05:30' });
    expect(res.body.application.timeline[0]).toMatchObject({ note: 'Applied via referral' });
  });
});

describe('list, filters and search', () => {
  beforeEach(async () => {
    await create({ companyName: 'Lumen Browser', roleTitle: 'Backend Platform Engineer', location: 'Hyderabad', status: 'applied', appliedOn: '2026-09-29', jd: 'Kafka and Go microservices' });
    await create({ companyName: 'Northwind Data', roleTitle: 'Senior Software Engineer', location: 'Remote', workMode: 'remote', status: 'interview', appliedOn: '2026-09-30', answers: [{ question: 'Comfortable with US hours?', answer: 'Yes, overlap until 1am IST' }] });
    await create({ companyName: 'Infosys', roleTitle: 'Node.js Developer', location: 'Pune', source: 'company_portal', status: 'shortlisted', appliedOn: '2026-10-01', notes: 'Found out by logging in' });
  });

  const list = async (query: string) => (await agent.get(`/api/applications?${query}`).expect(200)).body;

  it('lists newest first with company names', async () => {
    const body = await list('');
    expect(body.total).toBe(3);
    expect(body.items.map((i: { companyName: string }) => i.companyName)).toEqual(['Infosys', 'Northwind Data', 'Lumen Browser']);
    expect(body.items[2].hasJd).toBe(true);
  });

  it('filters by status, source, city, work mode and date range', async () => {
    expect((await list('status=applied,interview')).total).toBe(2);
    expect((await list('source=company_portal')).items[0].companyName).toBe('Infosys');
    expect((await list('city=hyder')).items[0].companyName).toBe('Lumen Browser');
    expect((await list('workMode=remote')).total).toBe(1);
    expect((await list('appliedFrom=2026-09-30&appliedTo=2026-09-30')).items[0].companyName).toBe('Northwind Data');
  });

  it('searches JD text, Q&A answers, notes and company names', async () => {
    expect((await list('q=kafka')).items[0].companyName).toBe('Lumen Browser'); // JD
    expect((await list('q=US hours')).items[0].companyName).toBe('Northwind Data'); // Q&A
    expect((await list('q=logging')).items[0].companyName).toBe('Infosys'); // notes
    expect((await list('q=upst')).items[0].companyName).toBe('Northwind Data'); // company substring
  });

  it('rejects unknown filter values', async () => {
    expect((await agent.get('/api/applications?status=bogus')).status).toBe(400);
  });

  it('archived applications are hidden by default', async () => {
    const id = (await list('q=infosys')).items[0].id;
    await agent.patch(`/api/applications/${id}`).set('Origin', ORIGIN).send({ archived: true }).expect(200);
    expect((await list('')).total).toBe(2);
    expect((await list('archived=true')).total).toBe(1);
  });
});

describe('update, JD snapshots, answers, contacts', () => {
  it('updates fields and re-canonicalizes the URL', async () => {
    const { id } = await create({});
    const res = await agent
      .patch(`/api/applications/${id}`)
      .set('Origin', ORIGIN)
      .send({ roleTitle: 'Senior Backend Developer', jobUrl: 'https://jobs.lever.co/acme/0b5a6c1e-1111-2222-3333-444455556666/apply', followUpOn: '2026-10-10' });
    expect(res.status).toBe(200);
    expect(res.body.application).toMatchObject({
      roleTitle: 'Senior Backend Developer',
      externalJobId: '0b5a6c1e-1111-2222-3333-444455556666',
      followUpOn: '2026-10-10',
    });
  });

  it('JD snapshots are kept, deduplicated by content, latest first', async () => {
    const { id } = await create({ jd: 'Version one' });
    expect((await post(`/api/applications/${id}/jd`, { content: 'Version one' })).body.created).toBe(false);
    const res = await post(`/api/applications/${id}/jd`, { content: 'Version two, edited by the employer' });
    expect(res.status).toBe(201);
    expect(res.body.application.jd.content).toBe('Version two, edited by the employer');
    expect(res.body.application.jdHistory).toHaveLength(2);

    const old = res.body.application.jdHistory[1];
    expect((await agent.get(`/api/applications/${id}/jd/${old.id}`)).body.jd.content).toBe('Version one');
  });

  it('replaces the Q&A list in order', async () => {
    const { id } = await create({ answers: [{ question: 'Old', answer: 'x' }] });
    const res = await agent
      .put(`/api/applications/${id}/answers`)
      .set('Origin', ORIGIN)
      .send({ answers: [{ question: 'Years of Node.js', answer: '3' }, { question: 'Notice period', answer: 'Immediate' }] });
    expect(res.body.application.answers.map((a: { question: string }) => a.question)).toEqual(['Years of Node.js', 'Notice period']);
  });

  it('stores recruiter contacts encrypted and returns them decrypted', async () => {
    const { id } = await create({});
    const created = await post(`/api/applications/${id}/contacts`, { name: 'Priya R', email: 'priya@acme.com', role: 'recruiter' });
    expect(created.status).toBe(201);

    const raw = await db.execute<{ name_enc: string; email_enc: string }>(sql`select name_enc, email_enc from contacts`);
    expect(raw.rows[0]!.name_enc).not.toContain('Priya');
    expect(raw.rows[0]!.email_enc).toMatch(/^v1\./);

    expect((await detail(id)).contacts).toEqual([expect.objectContaining({ name: 'Priya R', email: 'priya@acme.com' })]);

    await agent.patch(`/api/contacts/${created.body.contact.id}`).set('Origin', ORIGIN).send({ phone: '+91 90000 00000' }).expect(200);
    await agent.delete(`/api/contacts/${created.body.contact.id}`).set('Origin', ORIGIN).expect(204);
    expect((await detail(id)).contacts).toHaveLength(0);
  });

  it('deletes an application and its timeline', async () => {
    const { id } = await create({ jd: 'x' });
    await agent.delete(`/api/applications/${id}`).set('Origin', ORIGIN).expect(204);
    expect((await agent.get(`/api/applications/${id}`)).status).toBe(404);
  });
});

describe('follow-ups and ghost suggestions', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it('lists due follow-ups, no-response items, and ghost suggestions (without changing status)', async () => {
    const fresh = await create({ companyName: 'Fresh', status: 'applied' });
    const quiet = await create({ companyName: 'Quiet', status: 'applied' });
    const ghosty = await create({ companyName: 'Ghosty', status: 'interview' });
    const due = await create({ companyName: 'Due', status: 'interview', followUpOn: '2020-01-01' });
    await db.update(applications).set({ lastActivityAt: daysAgo(12) }).where(eq(applications.id, quiet.id));
    await db.update(applications).set({ lastActivityAt: daysAgo(25) }).where(eq(applications.id, ghosty.id));

    const body = (await agent.get('/api/follow-ups').expect(200)).body;
    const names = (rows: Array<{ companyName: string }>) => rows.map((r) => r.companyName).sort();

    const reasonOf = (name: string) => body.followUps.find((f: { companyName: string }) => f.companyName === name)?.reason;

    expect(names(body.followUps)).toEqual(['Due', 'Ghosty', 'Quiet']);
    expect(reasonOf('Due')).toBe('due');
    expect(body.followUps.find((f: { companyName: string }) => f.companyName === 'Quiet')).toMatchObject({ reason: 'no_response', daysSinceActivity: 12 });
    expect(reasonOf('Ghosty')).toBe('post_interview'); // and it still counts toward ghosting:
    expect(names(body.ghostSuggestions)).toEqual(['Ghosty']);
    expect(body.settings).toMatchObject({ followUpAfterDays: 10, postInterviewFollowUpDays: 5, ghostAfterDays: 21 });

    expect((await detail(ghosty.id)).status).toBe('interview'); // suggestion only
    expect(fresh.id).toBeTruthy();
  });

  it('post-interview check-in: Interview with no update for 5 days (default), not before', async () => {
    const recent = await create({ companyName: 'Recent', status: 'interview' });
    const stale = await create({ companyName: 'Stale', status: 'interview' });
    const dated = await create({ companyName: 'Dated', status: 'interview', followUpOn: '2099-01-01' });
    await db.update(applications).set({ lastActivityAt: daysAgo(4) }).where(eq(applications.id, recent.id));
    await db.update(applications).set({ lastActivityAt: daysAgo(6) }).where(eq(applications.id, stale.id));
    await db.update(applications).set({ lastActivityAt: daysAgo(6) }).where(eq(applications.id, dated.id));

    const body = (await agent.get('/api/follow-ups')).body;
    // An explicit future follow-up date wins over the automatic rule.
    expect(body.followUps).toEqual([expect.objectContaining({ companyName: 'Stale', reason: 'post_interview', daysSinceActivity: 6 })]);
    expect(body.ghostSuggestions).toHaveLength(0);
  });

  it('respects per-user overrides of the thresholds', async () => {
    const { id } = await create({ companyName: 'Quiet', status: 'applied' });
    await db.update(applications).set({ lastActivityAt: daysAgo(6) }).where(eq(applications.id, id));
    await db.execute(sql`update users set settings = '{"followUpAfterDays": 5, "ghostAfterDays": 6, "postInterviewFollowUpDays": 2}'::jsonb`);
    const body = (await agent.get('/api/follow-ups')).body;
    expect(body.followUps).toHaveLength(1);
    expect(body.ghostSuggestions).toHaveLength(1);
  });
});

describe('answer library', () => {
  it('CRUD with case-insensitive uniqueness', async () => {
    const created = await post('/api/answer-library', { question: 'Notice period?', answer: 'Immediate (0 days)' });
    expect(created.status).toBe(201);
    expect((await post('/api/answer-library', { question: 'notice PERIOD', answer: 'x' })).status).toBe(409);

    await agent.patch(`/api/answer-library/${created.body.item.id}`).set('Origin', ORIGIN).send({ answer: '15 days' }).expect(200);
    expect((await agent.get('/api/answer-library')).body.items[0].answer).toBe('15 days');
    await agent.delete(`/api/answer-library/${created.body.item.id}`).set('Origin', ORIGIN).expect(204);
  });
});

describe('isolation between users', () => {
  it("never exposes or modifies another user's applications", async () => {
    const mine = await create({ companyName: 'Mine' });
    await createUser(db, { email: 'other@example.com', password: PASSWORD });
    const other = await signIn('other@example.com');

    expect((await other.get('/api/applications')).body.total).toBe(0);
    expect((await other.get(`/api/applications/${mine.id}`)).status).toBe(404);
    expect((await other.patch(`/api/applications/${mine.id}`).set('Origin', ORIGIN).send({ notes: 'x' })).status).toBe(404);
    expect((await other.post(`/api/applications/${mine.id}/status`).set('Origin', ORIGIN).send({ status: 'offer' })).status).toBe(404);
    expect((await other.delete(`/api/applications/${mine.id}`).set('Origin', ORIGIN)).status).toBe(404);

    // Same company + role for another user is not a duplicate of mine.
    const res = await other.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Mine', roleTitle: 'Backend Developer' });
    expect(res.status).toBe(201);
  });

  it('requires auth', async () => {
    expect((await request(app).get('/api/applications')).status).toBe(401);
    expect((await request(app).get('/api/follow-ups')).status).toBe(401);
  });
});
