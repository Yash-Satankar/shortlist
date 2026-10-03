import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createApplication } from '../src/applications/service';
import { proposeStatus, undoEvent } from '../src/applications/status';
import { closeDb, getDb } from '../src/db/client';
import { applications, statusEvents } from '../src/db/schema';
import { getStats, weekStart } from '../src/stats/service';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const db = getDb();
let userId: string;

// Monday 5 Oct 2026, 00:30 IST = Sunday 4 Oct 19:00 UTC. A UTC-based week would still say "last week".
const NOW = new Date('2026-10-04T19:00:00Z');
const SUN_2359_IST = new Date('2026-10-04T18:29:00Z');
const MON_0001_IST = new Date('2026-10-04T18:31:00Z');

async function make(status: 'saved' | 'applied' | 'interview' | 'offer' | 'rejected' | 'viewed', appliedOn: string | null = '2026-09-28', name = `Co ${Math.random()}`) {
  const { id } = (await createApplication(db, userId, { companyName: name, roleTitle: 'Dev', status, appliedOn, via: 'manual', confirmDuplicate: false }, 'manual')).application;
  if (appliedOn === null) await db.update(applications).set({ appliedOn: null }).where(eq(applications.id, id));
  return id;
}

/** A status change that happened at a specific instant (the stats look at occurred_at). */
async function moveAt(id: string, status: Parameters<typeof proposeStatus>[1]['status'], at: Date, source: 'manual' | 'email' | 'portal' = 'manual') {
  const r = await proposeStatus(db, { userId, applicationId: id, status, source, occurredAt: at, confidence: 0.95 });
  return r.event!;
}

beforeEach(async () => {
  await resetDb();
  userId = (await createUser(db, { email: 'stats@example.com', password: 'correct horse battery' })).id;
});
afterAll(closeDb);

describe('week boundary: Monday 00:00 in the user timezone (default Asia/Kolkata)', () => {
  it('computes Monday 00:00 IST', async () => {
    const w = await weekStart(db, 'Asia/Kolkata', NOW);
    expect(w).toEqual({ start: new Date('2026-10-04T18:30:00Z'), startDate: '2026-10-05' });
  });

  it('a Sunday evening is still the previous week', async () => {
    const w = await weekStart(db, 'Asia/Kolkata', SUN_2359_IST);
    expect(w.startDate).toBe('2026-09-28');
  });

  it('follows a per-user timezone setting', async () => {
    await db.execute(sql`update users set settings = '{"timezone":"UTC"}'::jsonb`);
    expect((await getStats(db, userId, NOW)).week).toMatchObject({ startDate: '2026-09-28', timezone: 'UTC' });
  });
});

describe('GET /api/stats numbers', () => {
  it('applied this week counts applications with an applied date since Monday (IST)', async () => {
    await make('applied', '2026-10-04'); // Sunday: last week
    await make('applied', '2026-10-05'); // Monday: this week
    await make('saved', null);
    expect((await getStats(db, userId, NOW)).appliedThisWeek).toBe(1);
  });

  it('in play = Applied through Offer, excluding Saved and closed; interviews = Interview', async () => {
    await make('saved', null);
    await make('applied');
    await make('viewed');
    await make('interview');
    await make('offer');
    await make('rejected');
    const s = await getStats(db, userId, NOW);
    expect(s.active).toBe(4);
    expect(s.interviews).toBe(1);
  });

  it('archived applications are left out', async () => {
    const id = await make('interview');
    await db.update(applications).set({ archivedAt: new Date() }).where(eq(applications.id, id));
    expect(await getStats(db, userId, NOW)).toMatchObject({ active: 0, interviews: 0 });
  });

  it('replies: Saved/Applied → Viewed-or-later or Rejected, any source, counted per application, inside the IST week', async () => {
    const a = await make('applied');
    await moveAt(a, 'viewed', MON_0001_IST, 'portal'); // reply this week
    await moveAt(a, 'interview', MON_0001_IST, 'email'); // from Viewed: not a new reply

    const b = await make('applied');
    await moveAt(b, 'rejected', MON_0001_IST, 'email'); // rejection is a reply

    const c = await make('saved', null);
    await moveAt(c, 'assessment', MON_0001_IST); // from Saved

    const d = await make('applied');
    await moveAt(d, 'shortlisted', SUN_2359_IST); // last week (Sunday 23:59 IST)

    const e = await make('applied');
    await moveAt(e, 'ghosted', MON_0001_IST); // ghosted is not a reply

    expect((await getStats(db, userId, NOW)).repliesThisWeek).toBe(3); // a, b, c
  });

  it('an undone change is not a reply, and neither is its undo/redo', async () => {
    const a = await make('applied');
    const ev = await moveAt(a, 'interview', MON_0001_IST);
    await undoEvent(db, userId, a, ev.id);
    expect((await getStats(db, userId, NOW)).repliesThisWeek).toBe(0);
  });

  it('ignored and pending-review signals are not replies', async () => {
    const a = await make('applied');
    await proposeStatus(db, { userId, applicationId: a, status: 'offer', source: 'email', confidence: 0.99, occurredAt: MON_0001_IST }); // offer → review
    const rows = await db.select().from(statusEvents).where(eq(statusEvents.applicationId, a));
    expect(rows.some((r) => r.disposition === 'pending_review')).toBe(true);
    expect((await getStats(db, userId, NOW)).repliesThisWeek).toBe(0);
  });
});

describe('access', () => {
  it("never counts another user's data, and requires auth", async () => {
    await make('interview');
    await createUser(db, { email: 'other@example.com', password: 'correct horse battery' });
    const app = createApp({ db });
    const other = request.agent(app);
    await other.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'other@example.com', password: 'correct horse battery' }).expect(200);
    const res = await other.get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ appliedThisWeek: 0, active: 0, interviews: 0, repliesThisWeek: 0 });
    expect((await request(app).get('/api/stats')).status).toBe(401);
  });
});
