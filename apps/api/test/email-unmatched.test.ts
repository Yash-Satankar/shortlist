import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { applications, emails } from '../src/db/schema';
import { ingestEmail } from '../src/email/ingest';
import { parseRawMessage } from '../src/email/sources';
import { reprocessUnmatched } from '../src/email/unmatched';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';
const fixture = async (name: string) => (await parseRawMessage(readFileSync(path.join(import.meta.dirname, 'fixtures/emails', name))))!;

let userId: string;
let otherId: string;
let agent: ReturnType<typeof request.agent>;
const list = async () => (await agent.get('/api/applications?limit=100').expect(200)).body.items as { id: string; companyName: string; roleTitle: string; status: string; source: string }[];
const detail = async (id: string) => (await agent.get(`/api/applications/${id}`).expect(200)).body.application;

beforeEach(async () => {
  await resetDb();
  userId = (await createUser(db, { email: 'me@example.com', password: PASSWORD })).id;
  otherId = (await createUser(db, { email: 'other@example.com', password: PASSWORD })).id;
  agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'me@example.com', password: PASSWORD }).expect(200);
});
afterEach(() => {
  delete process.env.EMAIL_AUTOCREATE_FROM_CONFIRMATIONS;
  resetEnvCache();
});
afterAll(closeDb);

describe('a portal’s confirmation for a job you don’t track creates it as Applied', () => {
  it.each([
    ['confirm-linkedin.eml', 'Kestrel Fintech', 'Senior Backend Engineer', 'linkedin', 'https://www.linkedin.com/jobs/view/4199990001/', 'Dubai, United Arab Emirates'],
    ['confirm-linkedin-current.eml', 'Corvane', 'Senior Backend Engineer', 'linkedin', 'https://www.linkedin.com/jobs/view/4199990009/', 'Bengaluru'],
    ['confirm-naukri.eml', 'Orbit Labs Pvt Ltd', 'Node.js Developer', 'naukri', 'https://www.naukri.com/job-listings-node-js-developer-orbit-labs-pune-3-to-5-years-061026500123', 'Pune'],
    ['confirm-greenhouse.eml', 'Juniper Health', 'Platform Engineer', 'greenhouse', 'https://job-boards.greenhouse.io/juniperhealth/jobs/7001234', null],
    ['confirm-lever.eml', 'Nimbus Robotics', 'Robotics Software Engineer', 'lever', 'https://jobs.lever.co/nimbusrobotics/2b1c3d4e-5f60-4718-9a2b-3c4d5e6f7a8b', null],
    ['confirm-workday.eml', 'Talon Aerospace', 'Software Engineer II', 'workday', 'https://talonaero.wd5.myworkdayjobs.com/Careers/job/Bengaluru-India/Software-Engineer-II_R-24817', null],
    ['confirm-smartrecruiters.eml', 'Quill Media', 'Data Analyst', 'company_portal', 'https://jobs.smartrecruiters.com/QuillMedia/744000012345678', null],
    ['confirm-ashby.eml', 'Ferrous Labs', 'Founding Engineer', 'company_portal', 'https://jobs.ashbyhq.com/ferrouslabs/9f8e7d6c-5b4a-4321-8fed-cba987654321', null],
    ['confirm-successfactors.eml', 'Meridian Bank', 'Treasury Systems Developer', 'company_portal', 'https://career5.successfactors.eu/career?company=meridianbank&career_job_req_id=48211', null],
  ])('%s', async (file, company, role, source, url, location) => {
    const r = await ingestEmail(db, userId, 'imap', await fixture(file));
    expect(r).toMatchObject({ outcome: 'applied', category: 'received' });
    const d = await detail(r.applicationId!);
    expect(d).toMatchObject({ roleTitle: role, status: 'applied', source, appliedOn: '2026-10-06', location });
    expect(d.company.name).toBe(company);
    const [row] = await db.select({ canonical: applications.jobUrlCanonical }).from(applications).where(eq(applications.id, d.id));
    expect(row!.canonical).toBe(url);
    expect(d.jd ?? null).toBeNull(); // job description not captured
    const live = d.timeline.filter((e: { revertsEventId: string | null }) => !e.revertsEventId);
    expect(live.map((e: { toStatus: string; source: string }) => `${e.toStatus}:${e.source}`)).toEqual(['saved:email', 'applied:email']);
    expect(live[0].note).toMatch(/^Created from a \w+ email · job description not captured$/);
    expect(live[1]).toMatchObject({ evidenceType: 'email', confidence: 'high' });
  });

  it('undoable: Undo takes it back to Saved', async () => {
    const r = await ingestEmail(db, userId, 'imap', await fixture('confirm-linkedin.eml'));
    const ev = (await detail(r.applicationId!)).timeline.at(-1);
    const undone = await agent.post(`/api/applications/${r.applicationId}/events/${ev.id}/undo`).set('Origin', ORIGIN).send({});
    expect(undone.body.application.status).toBe('saved');
  });
});

describe('duplicate safety', () => {
  it('a job you already track by its link: matched, nothing created', async () => {
    const { id } = (await agent.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Kestrel', roleTitle: 'Backend', status: 'saved', jobUrl: 'https://www.linkedin.com/jobs/view/4199990001/' }).expect(201)).body.application;
    const r = await ingestEmail(db, userId, 'imap', await fixture('confirm-linkedin.eml'));
    expect(r).toMatchObject({ applicationId: id, outcome: 'applied' });
    expect(await list()).toHaveLength(1);
  });

  it('the same company and role without a link: “might be the same”, left for you', async () => {
    await agent.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Kestrel Fintech LLC', roleTitle: 'Senior Backend Engineer (Payments)', status: 'saved' }).expect(201);
    const r = await ingestEmail(db, userId, 'imap', await fixture('confirm-linkedin.eml'));
    expect(['unmatched', 'review']).toContain(r.outcome);
    expect(await list()).toHaveLength(1);
  });

  it('another role at a company you track is a new application', async () => {
    await agent.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Kestrel Fintech', roleTitle: 'Data Analyst', status: 'applied' }).expect(201);
    const r = await ingestEmail(db, userId, 'imap', await fixture('confirm-linkedin.eml'));
    expect(r.outcome).toBe('applied');
    expect((await list()).map((a) => a.roleTitle).sort()).toEqual(['Data Analyst', 'Senior Backend Engineer']);
  });

  it('later saves of the same job find the email-created application: the extension, by hand, and a second email', async () => {
    const r = await ingestEmail(db, userId, 'imap', await fixture('confirm-linkedin.eml'));
    // By hand with the link → exact duplicate
    const manual = await agent.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Kestrel Fintech', roleTitle: 'Senior Backend Engineer', jobUrl: 'https://www.linkedin.com/jobs/view/4199990001/?refId=abc', status: 'applied' });
    expect(manual.status).toBe(409);
    expect(manual.body.error.code).toBe('duplicate_exact');
    // By hand without the link → likely duplicate (asks)
    const noLink = await agent.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Kestrel Fintech', roleTitle: 'Senior Backend Engineer', status: 'applied' });
    expect(noLink.body.error.code).toBe('duplicate_likely');
    // The extension's submitted-page detection
    const token = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' }).expect(201)).body.token.token;
    const det = await request(app)
      .post('/api/applications/detected-submission')
      .set('Authorization', `Bearer ${token}`)
      .set('X-JT-Intent', 'auto')
      .send({ site: 'linkedin', jobUrl: 'https://www.linkedin.com/jobs/view/4199990001/', signal: 'post-apply modal', verified: true, companyName: 'Kestrel Fintech', roleTitle: 'Senior Backend Engineer' })
      .expect(200);
    expect(det.body).toMatchObject({ applicationId: r.applicationId, created: false });
    // A second confirmation email for the same job
    const again = await fixture('confirm-linkedin.eml');
    again.messageId = '<li-sent-101-resend@linkedin.com>';
    expect((await ingestEmail(db, userId, 'imap', again)).applicationId).toBe(r.applicationId);
    expect(await list()).toHaveLength(1);
  });
});

describe('everything else stays in review, with “Create new application” pre-filled', () => {
  it('interview for an untracked job, an offer, an employer’s own address: never auto-created', async () => {
    for (const f of ['untracked-interview-greenhouse.eml', 'untracked-offer.eml', 'employer-received.eml']) {
      expect((await ingestEmail(db, userId, 'imap', await fixture(f))).outcome).toBe('unmatched');
    }
    expect(await list()).toHaveLength(0);
    const items = (await agent.get('/api/emails/unmatched').expect(200)).body.items;
    const interview = items.find((i: { subject: string }) => /Interview invitation/.test(i.subject));
    expect(interview.suggestion).toMatchObject({ companyName: 'Sable Analytics', roleTitle: 'Analytics Engineer', jobUrl: 'https://job-boards.greenhouse.io/sableanalytics/jobs/7009999', appliedOn: '2026-10-06', portal: 'Greenhouse' });
  });

  it('switched off by env: confirmations wait too', async () => {
    process.env.EMAIL_AUTOCREATE_FROM_CONFIRMATIONS = 'false';
    resetEnvCache();
    expect((await ingestEmail(db, userId, 'imap', await fixture('confirm-lever.eml'))).outcome).toBe('unmatched');
  });

  it('“Create new application” (edited by you) creates it; what the email says goes through the rules', async () => {
    await ingestEmail(db, userId, 'imap', await fixture('untracked-interview-greenhouse.eml'));
    const [item] = (await agent.get('/api/emails/unmatched')).body.items;
    const r = await agent
      .post(`/api/emails/${item.id}/create`)
      .set('Origin', ORIGIN)
      .send({ companyName: 'Sable Analytics', roleTitle: 'Senior Analytics Engineer', location: 'Remote', jobUrl: item.suggestion.jobUrl })
      .expect(201);
    // This invite also thanks you for applying, so it's a little less sure (0.75): the interview waits for your OK.
    expect(r.body).toMatchObject({ outcome: 'review', category: 'interview' });
    const d = await detail(r.body.applicationId);
    expect(d).toMatchObject({ roleTitle: 'Senior Analytics Engineer', status: 'saved', location: 'Remote', source: 'greenhouse' });
    expect(d.timeline.at(-1)).toMatchObject({ toStatus: 'interview', disposition: 'pending_review' });
    expect((await agent.get('/api/emails/unmatched')).body.items).toHaveLength(0);
  });

  it('cross-user: someone else can’t create from my email', async () => {
    await ingestEmail(db, userId, 'imap', await fixture('untracked-offer.eml'));
    const [item] = (await agent.get('/api/emails/unmatched')).body.items;
    const b = request.agent(app);
    await b.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'other@example.com', password: PASSWORD }).expect(200);
    expect((await b.post(`/api/emails/${item.id}/create`).set('Origin', ORIGIN).send({ companyName: 'X', roleTitle: 'Y' })).status).toBe(404);
    expect((await b.get('/api/emails/unmatched')).body.items).toHaveLength(0);
  });
});

describe('re-running stored unmatched emails (one-off after this shipped)', () => {
  it('creates the application for an old confirmation, leaves the rest; per user', async () => {
    // As stored before: unmatched, encrypted excerpt only.
    const store = async (uid: string, f: string) => {
      const raw = await fixture(f);
      await db.insert(emails).values({
        userId: uid,
        source: 'imap',
        messageId: `${raw.messageId}-${uid}`,
        fromDomain: raw.from.address.split('@')[1]!,
        fromEnc: raw.from.name ? `${raw.from.name} <${raw.from.address}>` : raw.from.address,
        subjectEnc: raw.subject,
        excerptEnc: raw.text,
        receivedAt: raw.date,
        category: f.startsWith('confirm') ? 'received' : 'offer',
        confidence: f.startsWith('confirm') ? 0.88 : 0.7,
        classifiedBy: 'rules',
        outcome: 'unmatched',
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    };
    await store(userId, 'confirm-linkedin.eml');
    await store(userId, 'untracked-offer.eml');
    await store(otherId, 'confirm-ashby.eml');
    expect(await reprocessUnmatched(db)).toEqual({ checked: 3, matched: 0, created: 2, stillUnmatched: 1 });
    expect((await list()).map((a) => `${a.companyName}:${a.status}`)).toEqual(['Kestrel Fintech:applied']);
    const others = await db.select({ userId: applications.userId }).from(applications).where(eq(applications.userId, otherId));
    expect(others).toHaveLength(1);
    expect(await reprocessUnmatched(db)).toMatchObject({ checked: 1, created: 0 }); // idempotent
  });
});
