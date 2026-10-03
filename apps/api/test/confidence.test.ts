import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createApplication } from '../src/applications/service';
import { proposeStatus } from '../src/applications/status';
import { closeDb, getDb } from '../src/db/client';
import { statusEvents } from '../src/db/schema';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
const app = createApp({ db });
let userId: string;

const newApp = async (status: 'applied' | 'interview' = 'interview') =>
  (await createApplication(db, userId, { companyName: `Co ${Math.random()}`, roleTitle: 'Dev', status, via: 'manual', confirmDuplicate: false }, 'manual'))
    .application.id;

beforeEach(async () => {
  await resetDb();
  userId = (await createUser(db, { email: 'conf@example.com', password: 'correct horse battery' })).id;
});
afterAll(closeDb);

describe('numeric confidence (0–1) with a high/low threshold (default 0.8)', () => {
  it('stores the score and derives the label the UI shows', async () => {
    const id = await newApp();
    await proposeStatus(db, { userId, applicationId: id, status: 'rejected', source: 'portal', confidence: 0.92 });
    const [e] = await db.select().from(statusEvents).where(eq(statusEvents.source, 'portal'));
    expect(e!.confidenceScore).toBe(0.92);
    expect(e!.confidence).toBeNull(); // legacy column is no longer written
  });

  it('keeps the rule behaviour at the threshold: ≥ 0.8 applies a rejection, below waits for review', async () => {
    const a = await newApp();
    expect((await proposeStatus(db, { userId, applicationId: a, status: 'rejected', source: 'email', confidence: 0.8 })).decision).toEqual({
      disposition: 'applied',
      reason: 'rejection',
    });
    const b = await newApp();
    expect((await proposeStatus(db, { userId, applicationId: b, status: 'rejected', source: 'email', confidence: 0.79 })).decision).toEqual({
      disposition: 'pending_review',
      reason: 'low_confidence',
    });
  });

  it('an automatic signal with no score is stored as 0.5 (the old "low")', async () => {
    const id = await newApp();
    await proposeStatus(db, { userId, applicationId: id, status: 'rejected', source: 'email' });
    const [e] = await db.select().from(statusEvents).where(eq(statusEvents.source, 'email'));
    expect(e!.confidenceScore).toBe(0.5);
  });

  it('manual and import events have no confidence', async () => {
    const id = await newApp('applied');
    await proposeStatus(db, { userId, applicationId: id, status: 'interview', source: 'manual', confidence: 0.99 });
    const rows = await db.select().from(statusEvents);
    expect(rows.every((r) => r.confidenceScore === null)).toBe(true);
  });

  it('API returns `confidence` as the label (unchanged for the UI) plus `confidenceScore`', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'conf@example.com', password: 'correct horse battery' }).expect(200);
    const id = await newApp();
    await proposeStatus(db, { userId, applicationId: id, status: 'offer', source: 'email', confidence: 0.95 });
    await proposeStatus(db, { userId, applicationId: id, status: 'rejected', source: 'email', confidence: 0.3 });

    const timeline = (await agent.get(`/api/applications/${id}`)).body.application.timeline;
    const auto = timeline.filter((e: { source: string }) => e.source === 'email');
    expect(auto.map((e: { confidence: string; confidenceScore: number }) => [e.confidence, e.confidenceScore])).toEqual([
      ['high', 0.95],
      ['low', 0.3],
    ]);
    expect(timeline[0]).toMatchObject({ source: 'manual', confidence: null, confidenceScore: null });

    const reviews = (await agent.get('/api/reviews')).body.items;
    expect(reviews.map((r: { event: { confidence: string } }) => r.event.confidence).sort()).toEqual(['high', 'low']);
  });

  it('the extension can send a score; legacy words still work', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'conf@example.com', password: 'correct horse battery' }).expect(200);
    const { token } = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token;
    const ext = (id: string, confidence: unknown) =>
      request(app).post(`/api/applications/${id}/status`).set('Authorization', `Bearer ${token}`).set('X-JT-Intent', 'auto').send({ status: 'rejected', confidence });

    const a = await newApp();
    expect((await ext(a, 0.9)).body.application.timeline.at(-1)).toMatchObject({ confidence: 'high', confidenceScore: 0.9 });
    const b = await newApp();
    expect((await ext(b, 'low')).body.application.timeline.at(-1)).toMatchObject({ confidence: 'low', confidenceScore: 0.5 });
    expect((await ext(b, 1.5)).status).toBe(400);
  });
});

describe('migration 0006: legacy labels → scores', () => {
  it('maps high → 0.9 and low → 0.5, leaving user events null', async () => {
    const id = await newApp();
    // Rows as the old code wrote them: label only, no score.
    await db.insert(statusEvents).values([
      { userId, applicationId: id, fromStatus: 'interview', toStatus: 'rejected', source: 'email', disposition: 'pending_review', confidence: 'high' },
      { userId, applicationId: id, fromStatus: 'interview', toStatus: 'offer', source: 'portal', disposition: 'pending_review', confidence: 'low' },
    ]);
    const dir = path.resolve(import.meta.dirname, '../drizzle');
    const file = readdirSync(dir).find((f) => f.startsWith('0006_'))!;
    const update = readFileSync(path.join(dir, file), 'utf8').split('--> statement-breakpoint').find((s) => s.includes('UPDATE'))!;
    await db.execute(sql.raw(update));

    const rows = await db.select().from(statusEvents);
    const byLabel = Object.fromEntries(rows.map((r) => [r.confidence ?? 'none', r.confidenceScore]));
    expect(byLabel).toEqual({ high: 0.9, low: 0.5, none: null });
  });
});
