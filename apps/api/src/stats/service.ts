import type { ApplicationStatus } from '@jt/shared';
import { and, count, countDistinct, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { applications, statusEvents } from '../db/schema';
import { getNextFollowUp } from '../applications/follow-ups';
import { todayIn } from '../lib/dates';
import { getUserSettings } from '../users/service';

/** "In play": Applied through Offer, excluding Saved (as the inbox has always counted it). */
export const IN_PLAY_STATUSES: ApplicationStatus[] = ['applied', 'viewed', 'assessment', 'shortlisted', 'interview', 'offer'];
/** A reply moves an application from waiting (Saved/Applied)… */
const REPLY_FROM: ApplicationStatus[] = ['saved', 'applied'];
/** …to any sign the employer looked at it: Viewed or later, or Rejected. */
const REPLY_TO: ApplicationStatus[] = ['viewed', 'assessment', 'shortlisted', 'interview', 'offer', 'rejected'];

/**
 * Monday 00:00 of the current week in the user's timezone, as an instant and as a date.
 * Postgres date_trunc('week') starts weeks on Monday.
 */
export async function weekStart(db: DbOrTx, timezone: string, now: Date): Promise<{ start: Date; startDate: string }> {
  const { rows } = await db.execute<{ start: Date | string; start_date: string }>(sql`
    select (date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${timezone}) at time zone ${timezone}) as start,
           to_char(date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${timezone}), 'YYYY-MM-DD') as start_date`);
  return { start: new Date(rows[0]!.start), startDate: rows[0]!.start_date };
}

export async function getStats(db: DbOrTx, userId: string, now = new Date()) {
  const { timezone } = await getUserSettings(db, userId);
  const week = await weekStart(db, timezone, now);
  const mine = and(eq(applications.userId, userId), isNull(applications.archivedAt));

  const [[applied], [active], [interviews], [replies], nextFollowUp] = await Promise.all([
    db
      .select({ n: count() })
      .from(applications)
      .where(and(mine, gte(applications.appliedOn, week.startDate), lte(applications.appliedOn, todayIn(timezone, now)))),
    db.select({ n: count() }).from(applications).where(and(mine, inArray(applications.status, IN_PLAY_STATUSES))),
    db.select({ n: count() }).from(applications).where(and(mine, eq(applications.status, 'interview'))),
    db
      .select({ n: countDistinct(statusEvents.applicationId) })
      .from(statusEvents)
      .innerJoin(applications, eq(applications.id, statusEvents.applicationId))
      .where(
        and(
          mine,
          eq(statusEvents.disposition, 'applied'),
          isNull(statusEvents.revertedAt), // an undone change wasn't a reply…
          isNull(statusEvents.revertsEventId), // …and neither is an undo/redo
          inArray(statusEvents.fromStatus, REPLY_FROM),
          inArray(statusEvents.toStatus, REPLY_TO),
          gte(statusEvents.occurredAt, week.start),
          lte(statusEvents.occurredAt, now),
        ),
      ),
    getNextFollowUp(db, userId, now),
  ]);

  return {
    week: { start: week.start.toISOString(), startDate: week.startDate, timezone },
    appliedThisWeek: applied!.n,
    active: active!.n,
    interviews: interviews!.n,
    repliesThisWeek: replies!.n,
    /** The next follow-up not due yet (explicit date or automatic rule), for "Next one: …". */
    nextFollowUp,
  };
}
