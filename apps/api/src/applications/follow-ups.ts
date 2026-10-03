import { AWAITING_RESPONSE_STATUSES, OPEN_STATUSES, type FollowUpReason } from '@jt/shared';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { applications, companies } from '../db/schema';
import { daysBetween, DAY_MS, todayIn } from '../lib/dates';
import { env } from '../config/env';
import { getUserSettings } from '../users/service';

/** Not dismissed, or the dismissal has lapsed (new activity since, or GHOST_SUGGEST_DAYS passed). */
export function ghostNotDismissed(now: Date) {
  const until = new Date(now.getTime() - env().GHOST_SUGGEST_DAYS * DAY_MS);
  return or(
    isNull(applications.ghostDismissedAt),
    gt(applications.lastActivityAt, applications.ghostDismissedAt),
    lte(applications.ghostDismissedAt, until),
  );
}

/**
 * "Needs follow-up":
 *  - due:         an explicit follow-up date that is today or earlier, on any open application
 *  - no_response: Applied/Viewed with no activity for followUpAfterDays (and no follow-up date set)
 *  - post_interview: Interview with no activity for postInterviewFollowUpDays (no follow-up date set)
 *
 * "Ghost suggestions": open applications with no activity for ghostAfterDays.
 * These are only suggestions; marking Ghosted is always a manual status change.
 * "Not yet" (ghost_dismissed_at) hides one until new activity on that application or
 * GHOST_SUGGEST_DAYS after the dismissal, whichever comes first.
 */
export async function getFollowUps(db: DbOrTx, userId: string, now = new Date()) {
  const settings = await getUserSettings(db, userId);
  const today = todayIn(settings.timezone, now);
  const followUpCutoff = new Date(now.getTime() - settings.followUpAfterDays * DAY_MS);
  const postInterviewCutoff = new Date(now.getTime() - settings.postInterviewFollowUpDays * DAY_MS);
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
            and(
              isNull(applications.followUpOn),
              eq(applications.status, 'interview'),
              lte(applications.lastActivityAt, postInterviewCutoff),
            ),
          ),
        ),
      )
      .orderBy(sql`${applications.followUpOn} asc nulls last`, asc(applications.lastActivityAt)),
    db
      .select(select)
      .from(applications)
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(and(base, lte(applications.lastActivityAt, ghostCutoff), ghostNotDismissed(now)))
      .orderBy(asc(applications.lastActivityAt)),
  ]);

  const withDays = <T extends { lastActivityAt: Date }>(r: T) => ({ ...r, daysSinceActivity: daysBetween(r.lastActivityAt, now) });

  return {
    settings: {
      followUpAfterDays: settings.followUpAfterDays,
      postInterviewFollowUpDays: settings.postInterviewFollowUpDays,
      ghostAfterDays: settings.ghostAfterDays,
      today,
    },
    followUps: followRows.map((r) => ({ ...withDays(r), reason: followUpReason(r, today) })),
    ghostSuggestions: ghostRows.map(withDays),
  };
}

function followUpReason(row: { followUpOn: string | null; status: string }, today: string): FollowUpReason {
  if (row.followUpOn && row.followUpOn <= today) return 'due';
  return row.status === 'interview' ? 'post_interview' : 'no_response';
}
