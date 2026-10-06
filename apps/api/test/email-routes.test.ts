import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { resetEnvCache } from '../src/config/env';
import { closeDb, getDb } from '../src/db/client';
import { emailCursors, emailInboundAddresses } from '../src/db/schema';
import { ingestEmail } from '../src/email/ingest';
import { pollImap } from '../src/email/poll';
import { parseRawMessage, type ImapConfig } from '../src/email/sources';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';
const fixture = async (name: string) => (await parseRawMessage(readFileSync(path.join(import.meta.dirname, 'fixtures/emails', name))))!;
const IMAP_ENV = { FEATURE_EMAIL_INTAKE: 'true', EMAIL_INTAKE_MODE: 'imap', IMAP_HOST: 'imap.example.com', IMAP_USER: 'owner@example.com', IMAP_PASSWORD: 'app-password-secret' };
const INBOUND_ENV = { FEATURE_EMAIL_INTAKE: 'true', EMAIL_INTAKE_MODE: 'inbound', INBOUND_EMAIL_DOMAIN: 'in.example.com', INBOUND_WEBHOOK_USER: 'postmark', INBOUND_WEBHOOK_PASSWORD: 'a-long-webhook-secret' };
const KEYS = [...new Set([...Object.keys(IMAP_ENV), ...Object.keys(INBOUND_ENV)])];
const setEnv = (patch: Record<string, string>) => {
  Object.assign(process.env, patch);
  resetEnvCache();
};

let adminId: string;
let admin: ReturnType<typeof request.agent>;
let b: ReturnType<typeof request.agent>;
beforeEach(async () => {
  await resetDb();
  adminId = (await createUser(db, { email: 'admin@example.com', password: PASSWORD })).id; // first user → admin → mailbox owner
  await createUser(db, { email: 'b@example.com', password: PASSWORD });
  admin = request.agent(app);
  await admin.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'admin@example.com', password: PASSWORD }).expect(200);
  b = request.agent(app);
  await b.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'b@example.com', password: PASSWORD }).expect(200);
});
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  resetEnvCache();
});
afterAll(closeDb);

const save = async (agent: typeof admin, body: Record<string, unknown>) =>
  (await agent.post('/api/applications').set('Origin', ORIGIN).send({ status: 'applied', ...body }).expect(201)).body.application as { id: string };

describe('IMAP polling (fake mailbox)', () => {
  it('not offered unless configured', async () => {
    expect(await pollImap(db)).toEqual({ skipped: 'email intake (imap) not offered' });
  });

  it('reads from the cursor, ingests, and advances the cursor', async () => {
    setEnv(IMAP_ENV);
    await save(admin, { companyName: 'Acme Robotics', roleTitle: 'Backend Engineer' });
    const calls: unknown[] = [];
    const fetcher = async (_cfg: ImapConfig, cursor: { uidValidity: string | null; lastUid: number }) => {
      calls.push(cursor);
      return { emails: [await fixture('acme-rejection.eml'), await fixture('newsletter.eml')], cursor: { uidValidity: '42', lastUid: 17 } };
    };
    expect(await pollImap(db, fetcher)).toEqual({ read: 2, outcomes: { applied: 1, other: 1 } });
    expect(calls[0]).toEqual({ uidValidity: null, lastUid: 0 });
    await pollImap(db, async (_c, cursor) => (calls.push(cursor), { emails: [], cursor }));
    expect(calls[1]).toEqual({ uidValidity: '42', lastUid: 17 });
  });

  it('a failed run is recorded without credentials', async () => {
    setEnv(IMAP_ENV);
    await expect(pollImap(db, async () => Promise.reject(new Error('AUTHENTICATIONFAILED for owner@example.com with app-password-secret')))).rejects.toThrow();
    const [cur] = await db.select().from(emailCursors);
    expect(cur!.lastError).toBe('AUTHENTICATIONFAILED for [mailbox] with [redacted]');
  });

  it('runs never overlap: a second run while one is reading is skipped', async () => {
    setEnv(IMAP_ENV);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const slow = async (_c: ImapConfig, cursor: { uidValidity: string | null; lastUid: number }) => (calls++, await gate, { emails: [], cursor });
    const first = pollImap(db, slow);
    await new Promise((r) => setTimeout(r, 300));
    expect(await pollImap(db, slow)).toEqual({ skipped: 'already running' });
    release();
    expect(await first).toEqual({ read: 0, outcomes: {} });
    expect(calls).toBe(1);
    // …and once it's done, the next run goes ahead.
    expect(await pollImap(db, async (_c, cursor) => ({ emails: [], cursor }))).toEqual({ read: 0, outcomes: {} });
  });

  it('a lease left by a crashed run expires', async () => {
    setEnv(IMAP_ENV);
    await pollImap(db, async (_c, cursor) => ({ emails: [], cursor }));
    await db.update(emailCursors).set({ lockedUntil: new Date(Date.now() + 60_000) });
    expect(await pollImap(db, async (_c, cursor) => ({ emails: [], cursor }))).toEqual({ skipped: 'already running' });
    await db.update(emailCursors).set({ lockedUntil: new Date(Date.now() - 1000) });
    expect(await pollImap(db, async (_c, cursor) => ({ emails: [], cursor }))).toEqual({ read: 0, outcomes: {} });
  });

  it('repeated failures show in Settings, in Follow-ups (needs-you count) and clear on success', async () => {
    setEnv(IMAP_ENV);
    const fail = async () => Promise.reject(new Error('Command failed'));
    for (let i = 0; i < 2; i++) await expect(pollImap(db, fail)).rejects.toThrow();
    let s = (await admin.get('/api/emails/status')).body.mailbox;
    expect(s).toMatchObject({ failureCount: 2, needsAttention: false, lastError: 'Command failed' });
    await expect(pollImap(db, fail)).rejects.toThrow();
    s = (await admin.get('/api/emails/status')).body.mailbox;
    expect(s).toMatchObject({ failureCount: 3, needsAttention: true, reason: 'failing' });
    const needsYou = (await admin.get('/api/stats')).body.needsYou;
    expect(needsYou).toMatchObject({ mailbox: 1 });
    expect(needsYou.total).toBe(1);
    expect((await b.get('/api/stats')).body.needsYou).toMatchObject({ mailbox: 0, total: 0 }); // not their mailbox
    await pollImap(db, async (_c, cursor) => ({ emails: [], cursor }));
    s = (await admin.get('/api/emails/status')).body.mailbox;
    expect(s).toMatchObject({ failureCount: 0, needsAttention: false, lastError: null, lastSuccessAt: expect.any(String) });
    expect((await admin.get('/api/stats')).body.needsYou.mailbox).toBe(0);
  });

  it('no successful check for too long (scheduler stopped) also needs attention', async () => {
    setEnv({ ...IMAP_ENV, EMAIL_POLL_STALE_MINUTES: '30' });
    expect((await admin.get('/api/emails/status')).body.mailbox).toMatchObject({ needsAttention: false }); // never checked: not "broken" yet
    await pollImap(db, async (_c, cursor) => ({ emails: [], cursor }));
    const old = new Date(Date.now() - 31 * 60_000);
    await db.update(emailCursors).set({ lastRunAt: old, lastSuccessAt: old });
    expect((await admin.get('/api/emails/status')).body.mailbox).toMatchObject({ needsAttention: true, reason: 'stale' });
    delete process.env.EMAIL_POLL_STALE_MINUTES;
  });

  it('skips when the owner switched email updates off', async () => {
    setEnv(IMAP_ENV);
    await admin.patch('/api/features').set('Origin', ORIGIN).send({ email_intake: false }).expect(200);
    expect(await pollImap(db, async () => Promise.reject(new Error('should not run')))).toEqual({ skipped: 'switched off by the owner' });
  });
});

describe('/api/emails', () => {
  it('status shows the masked mailbox to its owner only', async () => {
    setEnv(IMAP_ENV);
    const s = (await admin.get('/api/emails/status').expect(200)).body;
    expect(s).toMatchObject({ mode: 'imap', offered: true, mailbox: { address: 'ow•••@example.com', folder: 'INBOX' } });
    expect(JSON.stringify(s)).not.toContain('app-password-secret');
    expect((await b.get('/api/emails/status').expect(200)).body.mailbox).toBeNull();
    expect((await b.post('/api/emails/check').set('Origin', ORIGIN)).status).toBe(403);
  });

  it('unmatched emails can be assigned (your match: the classification confidence applies) or dismissed', async () => {
    setEnv(IMAP_ENV);
    const one = await save(admin, { companyName: 'Hooli', roleTitle: 'Data Engineer II' });
    await save(admin, { companyName: 'Hooli', roleTitle: 'ML Engineer' });
    await ingestEmail(db, adminId, 'imap', await fixture('hooli-unmatched.eml'));
    expect((await admin.get('/api/stats')).body.needsYou).toMatchObject({ emails: 1 });
    const [item] = (await admin.get('/api/emails/unmatched').expect(200)).body.items;
    expect(item).toMatchObject({ subject: 'Next step: online assessment', from: 'Hooli Careers <careers@hooli.example>', category: 'assessment' });
    const res = await admin.post(`/api/emails/${item.id}/assign`).set('Origin', ORIGIN).send({ applicationId: one.id });
    expect(res.body).toMatchObject({ outcome: 'applied', applicationId: one.id });
    expect((await admin.get(`/api/applications/${one.id}`)).body.application.status).toBe('assessment');
    expect((await admin.get('/api/emails/unmatched')).body.items).toHaveLength(0);
  });

  it('cross-user: someone else’s email can’t be read, assigned or dismissed', async () => {
    setEnv(IMAP_ENV);
    await save(admin, { companyName: 'Hooli', roleTitle: 'Data Engineer II' });
    await save(admin, { companyName: 'Hooli', roleTitle: 'ML Engineer' });
    await ingestEmail(db, adminId, 'imap', await fixture('hooli-unmatched.eml'));
    const [item] = (await admin.get('/api/emails/unmatched')).body.items;
    const mine = await save(b, { companyName: 'Hooli', roleTitle: 'Data Engineer II' });
    expect((await b.get('/api/emails/unmatched')).body.items).toHaveLength(0);
    expect((await b.post(`/api/emails/${item.id}/assign`).set('Origin', ORIGIN).send({ applicationId: mine.id })).status).toBe(404);
    expect((await b.post(`/api/emails/${item.id}/dismiss`).set('Origin', ORIGIN)).status).toBe(404);
  });
});

describe('inbound webhook (Postmark)', () => {
  const auth = (pw = 'a-long-webhook-secret') => `Basic ${Buffer.from(`postmark:${pw}`).toString('base64')}`;
  const payload = (to: string) => ({
    FromFull: { Email: 'talent@acme.example', Name: 'Acme Robotics Talent' },
    ToFull: [{ Email: to }],
    Subject: 'Your application for Backend Engineer',
    TextBody: 'Unfortunately, we have decided to move forward with other candidates.',
    Headers: [{ Name: 'Message-ID', Value: '<pm-77@acme.example>' }],
  });

  it('off unless inbound mode is configured', async () => {
    expect((await request(app).post('/api/email/inbound/postmark').send(payload('u-x@in.example.com'))).status).toBe(404);
  });

  it('bad credentials → 401; good ones route by forwarding address (no Origin header needed)', async () => {
    setEnv(INBOUND_ENV);
    const { address } = (await admin.get('/api/emails/inbound-address').expect(200)).body;
    expect(address).toMatch(/^u-[a-z0-9]+@in\.example\.com$/);
    const { id } = await save(admin, { companyName: 'Acme Robotics', roleTitle: 'Backend Engineer' });
    expect((await request(app).post('/api/email/inbound/postmark').set('Authorization', auth('nope')).send(payload(address))).status).toBe(401);
    const ok = await request(app).post('/api/email/inbound/postmark').set('Authorization', auth()).send(payload(address));
    expect(ok.body).toEqual({ ok: true, outcome: 'applied' });
    expect((await admin.get(`/api/applications/${id}`)).body.application.status).toBe('rejected');
    const again = await request(app).post('/api/email/inbound/postmark').set('Authorization', auth()).send(payload(address));
    expect(again.body).toEqual({ ok: true, outcome: 'duplicate' });
  });

  it('unknown or regenerated addresses are ignored; another user’s address only reaches that user', async () => {
    setEnv(INBOUND_ENV);
    const first = (await admin.get('/api/emails/inbound-address')).body.address;
    const second = (await admin.post('/api/emails/inbound-address/regenerate').set('Origin', ORIGIN)).body.address;
    expect(second).not.toBe(first);
    expect((await request(app).post('/api/email/inbound/postmark').set('Authorization', auth()).send(payload(first))).body).toEqual({ ok: true, ignored: 'unknown address' });
    const bAddress = (await b.get('/api/emails/inbound-address')).body.address;
    const { id } = await save(admin, { companyName: 'Acme Robotics', roleTitle: 'Backend Engineer' });
    await request(app).post('/api/email/inbound/postmark').set('Authorization', auth()).send(payload(bAddress)).expect(200);
    expect((await admin.get(`/api/applications/${id}`)).body.application.status).toBe('applied');
    const rows = (await db.execute(sql`select count(*)::int as n from email_inbound_addresses`)).rows as { n: number }[];
    expect(rows[0]!.n).toBe(2);
    expect((await db.select().from(emailInboundAddresses)).every((r) => /^u-[a-z0-9]+$/.test(r.localPart))).toBe(true);
  });
});
