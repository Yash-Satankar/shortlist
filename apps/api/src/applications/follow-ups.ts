import { AWAITING_RESPONSE_STATUSES, OPEN_STATUSES } from '@jt/shared';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { applications, companies } from '../db/schema';
import { daysBetween, DAY_MS, todayIn } from '../lib/dates';
import { getUserSettings } from '../users/service';

/**
 * "Needs follow-up":
 *  - due:         an explicit follow-up date that is today or earlier, on any open application
 *  - no_response: Applied/Viewed with no activity for followUpAfterDays (and no follow-up date set)
 *
 * "Ghost suggestions": open applications with no activity for ghostAfterDays.
 * These are only suggestions; marking Ghosted is always a manual status change.
 */
export async function getFollowUps(db: DbOrTx, userId: string, now = new Date()) {
  const settings = await getUserSettings(db, userId);
  const today = todayIn(settings.timezone, now);
  const followUpCutoff = new Date(now.getTime() - settings.followUpAfterDays * DAY_MS);
  const ghostCutoff = new Date(now.getTime() - settings.ghostAfterDays * DAY_MS);

  const base = and(eq(applications.userId, userId), isNull(applications.archivedAt), inArray(applications.status, [...OPEN_STATUSES]));

  const select = {
    id: applications.id,
    companyName: companies.name,
    roleTitle: applications.roleTitle,
    status: applications.status,
    appliedOn: applications.appliedOn,
    followUpOn: applications.followUpOn,
    lastActivityAt: applications.lastActivityAt,
    jobUrl: applications.jobUrl,
  };

  const [followRows, ghostRows] = await Promise.all([
    db
      .select(select)
      .from(applications)
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(
        and(
          base,
          or(
            lte(applications.followUpOn, today),
            and(
              isNull(applications.followUpOn),
              inArray(applications.status, [...AWAITING_RESPONSE_STATUSES]),
              lte(applications.lastActivityAt, followUpCutoff),
            ),
          ),
        ),
      )
      .orderBy(sql`${applications.followUpOn} asc nulls last`, asc(applications.lastActivityAt)),
    db
      .select(select)
      .from(applications)
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(and(base, lte(applications.lastActivityAt, ghostCutoff)))
      .orderBy(asc(applications.lastActivityAt)),
  ]);

  const withDays = <T extends { lastActivityAt: Date }>(r: T) => ({ ...r, daysSinceActivity: daysBetween(r.lastActivityAt, now) });

  return {
    settings: { followUpAfterDays: settings.followUpAfterDays, ghostAfterDays: settings.ghostAfterDays, today },
    followUps: followRows.map((r) => ({
      ...withDays(r),
      reason: r.followUpOn && r.followUpOn <= today ? ('due' as const) : ('no_response' as const),
    })),
    ghostSuggestions: ghostRows.map(withDays),
  };
}
