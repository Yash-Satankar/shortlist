import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { emails } from '../src/db/schema';
import { ingestEmail, previewEmail } from '../src/email/ingest';
import { parseRawMessage, postmarkAdapter, unwrap } from '../src/email/sources';
import { providerFactory } from '../src/llm/providers';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';
const fixture = async (name: string) => (await parseRawMessage(readFileSync(path.join(import.meta.dirname, 'fixtures/emails', name))))!;

let userId: string;
let agent: ReturnType<typeof request.agent>;
const save = async (body: Record<string, unknown>) =>
  (await agent.post('/api/applications').set('Origin', ORIGIN).send({ status: 'applied', ...body }).expect(201)).body.application as { id: string };
const detail = async (id: string) => (await agent.get(`/api/applications/${id}`).expect(200)).body.application;

beforeEach(async () => {
  await resetDb();
  userId = (await createUser(db, { email: 'a@example.com', password: PASSWORD })).id;
  await createUser(db, { email: 'b@example.com', password: PASSWORD });
  agent = request.agent(app);
  await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'a@example.com', password: PASSWORD }).expect(200);
});
afterAll(closeDb);

describe('parsing', () => {
  it('reads sender, subject, date, text (HTML flattened) and links from a raw message', async () => {
    const m = await fixture('greenhouse-received.eml');
    expect(m).toMatchObject({ messageId: '<gh-received-001@greenhouse-mail.io>', from: { address: 'no-reply@greenhouse-mail.io', name: 'Acme Robotics Hiring Team' }, subject: 'Thank you for applying to Acme Robotics' });
    expect(m.text).toContain('We have received your application for Backend Engineer');
    expect(m.links).toContain('https://job-boards.greenhouse.io/acme/jobs/7000001');
  });
});

describe('forwarded emails', () => {
  it('a manual forward is read as the original email (sender, subject, body)', async () => {
    const m = await fixture('forwarded-greenhouse.eml');
    expect(m).toMatchObject({ messageId: '<fwd-006@mail.gmail.com>', from: { address: 'no-reply@us.greenhouse-mail.io', name: 'Vandelay Industries' }, subject: 'Thank you for applying to Vandelay Industries' });
    expect(m.text).toContain('We have received your application for the Site Reliability Engineer position');
    expect(m.text).not.toContain('Forwarded message');
  });

  it('…so it classifies and matches like the original', async () => {
    const { id } = await save({ companyName: 'Vandelay Industries', roleTitle: 'Site Reliability Engineer', status: 'saved' });
    const r = await ingestEmail(db, userId, 'imap', await fixture('forwarded-greenhouse.eml'));
    expect(r).toMatchObject({ category: 'received', applicationId: id });
  });
});

describe('unwrap', () => {
  it('rejoins hard-wrapped lines, keeps paragraphs and list items', () => {
    expect(unwrap('We have received your application\nfor Backend Engineer.\n\nNext steps:\n- a test\n- an interview')).toBe(
      'We have received your application for Backend Engineer.\n\nNext steps:\n- a test\n- an interview',
    );
  });
});

describe('ingest', () => {
  it('a job link in the email matches exactly; "received" confirms Applied (no change → ignored, noted once)', async () => {
    const { id } = await save({ companyName: 'Acme Robotics', roleTitle: 'Backend Engineer', jobUrl: 'https://job-boards.greenhouse.io/acme/jobs/7000001' });
    const r = await ingestEmail(db, userId, 'imap', await fixture('greenhouse-received.eml'));
    expect(r).toMatchObject({ outcome: 'ignored', category: 'received', applicationId: id });
    const [row] = await db.select().from(emails);
    expect(row).toMatchObject({ matchedBy: 'url', classifiedBy: 'rules', fromDomain: 'greenhouse-mail.io' });
  });

  it('a clear rejection matched by company + role applies Rejected, on the timeline with source and evidence, undoable', async () => {
    const { id } = await save({ companyName: 'Acme Robotics', roleTitle: 'Backend Engineer' });
    await save({ companyName: 'Acme Robotics', roleTitle: 'Data Engineer' });
    const r = await ingestEmail(db, userId, 'imap', await fixture('acme-rejection.eml'));
    expect(r).toMatchObject({ outcome: 'applied', category: 'rejected', applicationId: id });
    const d = await detail(id);
    expect(d.status).toBe('rejected');
    const ev = d.timeline.at(-1);
    expect(ev).toMatchObject({ source: 'email', evidenceType: 'email', note: 'Email from acme.example: rejection', confidence: 'high' });
    const undo = await agent.post(`/api/applications/${id}/events/${ev.id}/undo`).set('Origin', ORIGIN).send({});
    expect(undo.body.application.status).toBe('applied');
  });

  it('matched by company alone: never more than the company-match cap, so it waits for review', async () => {
    const { id } = await save({ companyName: 'Globex', roleTitle: 'SRE' });
    const r = await ingestEmail(db, userId, 'imap', await fixture('globex-interview.eml'));
    expect(r).toMatchObject({ outcome: 'review', category: 'interview', applicationId: id });
    expect((await detail(id)).status).toBe('applied');
  });

  it('several applications at the company and no role named → unmatched, nothing changes', async () => {
    await save({ companyName: 'Hooli', roleTitle: 'Data Engineer II' });
    await save({ companyName: 'Hooli', roleTitle: 'ML Engineer' });
    const r = await ingestEmail(db, userId, 'imap', await fixture('hooli-unmatched.eml'));
    expect(r).toMatchObject({ outcome: 'unmatched', category: 'assessment', applicationId: null });
  });

  it('emails that are not about an application are not stored at all', async () => {
    const r = await ingestEmail(db, userId, 'imap', await fixture('newsletter.eml'));
    expect(r).toMatchObject({ outcome: 'other', emailId: null });
    expect(await db.select().from(emails)).toHaveLength(0);
  });

  it('idempotent per Message-ID: the same email twice changes nothing more', async () => {
    const { id } = await save({ companyName: 'Acme Robotics', roleTitle: 'Backend Engineer' });
    await ingestEmail(db, userId, 'imap', await fixture('acme-rejection.eml'));
    const events = (await detail(id)).timeline.length;
    expect((await ingestEmail(db, userId, 'imap', await fixture('acme-rejection.eml'))).outcome).toBe('duplicate');
    expect((await detail(id)).timeline.length).toBe(events);
  });

  it('sender, subject and excerpt are stored encrypted', async () => {
    await save({ companyName: 'Acme Robotics', roleTitle: 'Backend Engineer' });
    await ingestEmail(db, userId, 'imap', await fixture('acme-rejection.eml'));
    const [raw] = (await db.execute(sql`select from_enc, subject_enc, excerpt_enc from emails`)).rows as Record<string, string>[];
    for (const v of Object.values(raw!)) {
      expect(v).toMatch(/^v1\./);
      expect(v).not.toContain('Acme');
    }
  });

  it('cross-user: another user’s email never touches my applications', async () => {
    const { id } = await save({ companyName: 'Acme Robotics', roleTitle: 'Backend Engineer' });
    const [b] = (await db.execute(sql`select id from users where email = 'b@example.com'`)).rows as { id: string }[];
    const r = await ingestEmail(db, b!.id, 'imap', await fixture('acme-rejection.eml'));
    expect(r).toMatchObject({ outcome: 'unmatched', applicationId: null });
    expect((await detail(id)).status).toBe('applied');
    expect((await db.select().from(emails).where(eq(emails.userId, userId)))).toHaveLength(0);
  });
});

describe('confidence: job portal sender + the job’s own link', () => {
  const LINKEDIN_JOB = 'https://www.linkedin.com/jobs/view/4100000001/';
  afterEach(() => {
    delete process.env.EMAIL_ATS_LINK_MATCH_CONFIDENCE;
    delete process.env.EMAIL_RULE_CONFIDENCE_JSON;
    resetEnvCache();
  });

  it('a "viewed" notice from LinkedIn matched by the job link scores high and applies, undoable', async () => {
    const { id } = await save({ companyName: 'Initech', roleTitle: 'Node JS Developer', jobUrl: LINKEDIN_JOB });
    const preview = await previewEmail(db, userId, await fixture('linkedin-viewed.eml'));
    expect(preview).toMatchObject({ category: 'viewed', match: { by: 'url' }, proposal: { to: 'viewed', confidence: 0.92, disposition: 'applied' } });
    const r = await ingestEmail(db, userId, 'imap', await fixture('linkedin-viewed.eml'));
    expect(r).toMatchObject({ outcome: 'applied', category: 'viewed', applicationId: id });
    const d = await detail(id);
    expect(d.status).toBe('viewed');
    const ev = d.timeline.at(-1);
    expect(ev).toMatchObject({ source: 'email', confidence: 'high', note: 'Email from linkedin.com: application viewed' });
    expect((await agent.post(`/api/applications/${id}/events/${ev.id}/undo`).set('Origin', ORIGIN).send({})).body.application.status).toBe('applied');
  });

  it('the same notice matched by company alone stays capped and waits for review', async () => {
    const { id } = await save({ companyName: 'Initech', roleTitle: 'Backend Developer' }); // no job link saved, another title
    const raw = await fixture('linkedin-viewed.eml');
    raw.subject = 'Your application was viewed: update from Initech';
    const r = await ingestEmail(db, userId, 'imap', raw);
    expect(r).toMatchObject({ outcome: 'review', applicationId: id });
    expect((await detail(id)).status).toBe('applied');
  });

  it('an employer’s own domain (not a portal) matched by link keeps the rule’s score', async () => {
    const raw = await fixture('linkedin-viewed.eml');
    raw.from = { address: 'talent@initech.example', name: 'Initech Talent' };
    await save({ companyName: 'Initech', roleTitle: 'Node JS Developer', jobUrl: LINKEDIN_JOB });
    expect((await previewEmail(db, userId, raw)).proposal).toMatchObject({ confidence: 0.75, disposition: 'pending_review' });
  });

  it('the scores are env-tunable', async () => {
    process.env.EMAIL_ATS_LINK_MATCH_CONFIDENCE = '0.7';
    process.env.EMAIL_RULE_CONFIDENCE_JSON = '{"viewed": 0.5}';
    resetEnvCache();
    await save({ companyName: 'Initech', roleTitle: 'Node JS Developer', jobUrl: LINKEDIN_JOB });
    const p = await previewEmail(db, userId, await fixture('linkedin-viewed.eml'));
    expect(p).toMatchObject({ confidence: 0.5, proposal: { confidence: 0.7, disposition: 'pending_review' } });
  });

  it('the boost never overrides the status rules: an offer from a portal still waits for review', async () => {
    const raw = await fixture('linkedin-viewed.eml');
    raw.subject = 'Your job offer from Initech';
    raw.text = `We are delighted to extend you an offer of employment. ${LINKEDIN_JOB}`;
    await save({ companyName: 'Initech', roleTitle: 'Node JS Developer', jobUrl: LINKEDIN_JOB });
    expect((await previewEmail(db, userId, raw)).proposal).toMatchObject({ to: 'offer', disposition: 'pending_review' });
  });
});

describe('AI fallback (only when rules are unsure and AI is on)', () => {
  it('without a key the rules result stands and nothing is sent to a provider', async () => {
    let called = false;
    const real = providerFactory.create;
    providerFactory.create = () => ({ validate: async () => undefined, complete: async () => ((called = true), { text: '{}', model: 'm', inputTokens: 0, outputTokens: 0 }) });
    const m = await fixture('newsletter.eml');
    m.subject = 'About your application';
    m.text = 'We will get back to you about the role soon.';
    expect((await ingestEmail(db, userId, 'imap', m)).outcome).toBe('other');
    expect(called).toBe(false);
    providerFactory.create = real;
  });
});

describe('inbound (Postmark) adapter', () => {
  const pm = postmarkAdapter({ domain: 'in.example.com', basicUser: 'postmark', basicPassword: 'a-long-webhook-secret' });
  it('authenticates the webhook with Basic credentials (constant-time)', () => {
    expect(pm.authorized(`Basic ${Buffer.from('postmark:a-long-webhook-secret').toString('base64')}`)).toBe(true);
    expect(pm.authorized(`Basic ${Buffer.from('postmark:wrong').toString('base64')}`)).toBe(false);
    expect(pm.authorized(undefined)).toBe(false);
  });
  it('maps a Postmark payload to the same email shape and finds the recipient', () => {
    const out = pm.parse({
      FromFull: { Email: 'Talent@Acme.example', Name: 'Acme Talent' },
      ToFull: [{ Email: 'u-abc123@in.example.com' }],
      Subject: 'Your application',
      TextBody: 'Unfortunately we will not be moving forward with your application.',
      HtmlBody: '<a href="https://jobs.lever.co/acme/1f2e3d4c-5b6a-4987-8a1b-2c3d4e5f6a7b">job</a>',
      Headers: [{ Name: 'Message-ID', Value: '<pm-1@acme.example>' }],
      Date: 'Sat, 10 Oct 2026 12:00:00 +0530',
    });
    expect(out).toMatchObject({ recipientLocalPart: 'u-abc123', email: { messageId: '<pm-1@acme.example>', from: { address: 'talent@acme.example' } } });
    expect(out!.email.links).toContain('https://jobs.lever.co/acme/1f2e3d4c-5b6a-4987-8a1b-2c3d4e5f6a7b');
  });
  it('ignores mail not addressed to the inbound domain, and malformed payloads', () => {
    expect(pm.parse({ FromFull: { Email: 'x@y.z' }, ToFull: [{ Email: 'someone@else.example' }] })).toBeNull();
    expect(pm.parse({ nope: true })).toBeNull();
  });
});
