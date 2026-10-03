import type { FollowUpReason } from '@jt/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useFollowUps, useQuickUpdate, useReviewAny, useReviews, useStats } from '../api/hooks';
import type { FollowUpItem, FollowUps } from '../api/types';
import { Icon, type IconName } from '../components/Icon';
import { ScreenHeader } from '../components/Layout';
import { Button, Confidence, ErrorNote, EventSourceBadge, SectionLabel, Sheet, SkeletonRows, StatusPill, useToast } from '../components/ui';
import { formatDate, formatDay, formatEventTime, isoDateFromToday, REASON_LABELS, shortAge } from '../lib/format';
import { dismissGhost, useVisibleGhosts } from '../lib/ghost';

const REASON: Record<FollowUpReason, { icon: IconName; label: (s: FollowUps['settings']) => string }> = {
  due: { icon: 'calendar', label: () => 'Follow-up date due' },
  no_response: { icon: 'clock', label: (s) => `No response in ${s.followUpAfterDays} days` },
  post_interview: { icon: 'chat', label: () => 'Post-interview check-in' },
};


/** Everything that needs me: flagged automatic changes, follow-ups, and possible ghosting. */
export function FollowUpsPage() {
  const followUps = useFollowUps();
  const reviews = useReviews();
  const review = useReviewAny();
  const quick = useQuickUpdate();
  const toast = useToast();
  const [menuFor, setMenuFor] = useState<FollowUpItem | null>(null);
  const data = followUps.data;
  const ghosts = useVisibleGhosts(data?.ghostSuggestions);

  const onError = (err: unknown) => toast({ message: err instanceof Error ? err.message : 'Failed', tone: 'error' });
  const snooze = (item: FollowUpItem, days: number) =>
    quick.mutate(
      { id: item.id, patch: { followUpOn: isoDateFromToday(days) } },
      { onSuccess: () => toast({ message: `${item.companyName}: next follow-up ${formatDay(isoDateFromToday(days))}`, tone: 'info' }), onError },
    );

  const total = (reviews.data?.length ?? 0) + (data?.followUps.length ?? 0) + ghosts.length;
  const today = data ? formatDay(data.settings.today) : '';

  return (
    <div className="mx-auto max-w-[720px]">
      <ScreenHeader
        title="Follow-ups"
        sub={
          data &&
          (total ? (
            <>
              <b className="font-semibold text-accent-text">{total} need you</b> · {today}
            </>
          ) : (
            `All clear · ${today}`
          ))
        }
      />

      <main className="pb-6">
        {(followUps.error || reviews.error) && (
          <div className="px-4 pt-3">
            <ErrorNote error={followUps.error ?? reviews.error} onRetry={() => (void followUps.refetch(), void reviews.refetch())} />
          </div>
        )}

        {followUps.isPending || reviews.isPending ? (
          <div className="pt-4">
            <SkeletonRows count={4} />
          </div>
        ) : total === 0 && data ? (
          <AllClear settings={data.settings} />
        ) : (
          <>
            {!!reviews.data?.length && (
              <section>
                <SectionLabel count={reviews.data.length} action="Automatic changes">
                  Pending reviews
                </SectionLabel>
                <div className="flex flex-col gap-2.5 px-4">
                  {reviews.data.map(({ event, application, company }) => (
                    <article key={event.id} className="card pt-3.5 pb-3">
                      <Link to={`/applications/${application.id}`} className="flex items-baseline gap-2">
                        <span className="co flex-none">{company.name}</span>
                        <span className="role m-0 text-[13px]">{application.roleTitle}</span>
                      </Link>
                      <div className="mt-2.5 flex items-center gap-2">
                        <StatusPill status={application.status} />
                        <Icon name="arrowRight" size="sm" className="text-ink-3" />
                        <StatusPill status={event.toStatus} />
                      </div>
                      <div className="ev-m mt-2">
                        <EventSourceBadge source={event.source} />
                        {event.confidence && <Confidence value={event.confidence} />}
                        <span className="ev-time">{formatEventTime(event.occurredAt)}</span>
                      </div>
                      {(event.note || (event.reason && REASON_LABELS[event.reason])) && (
                        <p className="mt-2 text-[13px] leading-[19px] text-ink-2 italic">{event.note || REASON_LABELS[event.reason!]}</p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="ink"
                          className="flex-1"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ applicationId: application.id, eventId: event.id, decision: 'accept' }, { onError })}
                        >
                          <Icon name="check" />
                          Accept
                        </Button>
                        <Button
                          className="flex-1"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ applicationId: application.id, eventId: event.id, decision: 'dismiss' }, { onError })}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {!!data?.followUps.length && (
              <section className="pt-1">
                <SectionLabel count={data.followUps.length} className="pt-5">
                  Follow-ups
                </SectionLabel>
                <div className="px-4">
                  <div className="group">
                    {data.followUps.map((item) => (
                      <div key={item.id} className="px-3.5 py-3 shadow-[inset_0_-1px_0_var(--line)] last:shadow-none">
                        <div className="flex items-center gap-2">
                          <span className="rc">
                            <Icon name={REASON[item.reason].icon} />
                            {REASON[item.reason].label(data.settings)}
                          </span>
                          <span className="sp" />
                          <span className="age">{item.reason === 'due' && item.followUpOn ? shortAge(item.followUpOn) : `${item.daysSinceActivity}d`}</span>
                        </div>
                        <Link to={`/applications/${item.id}`} className="r1 mt-2">
                          <span className="co">{item.companyName}</span>
                          <StatusPill status={item.status} />
                        </Link>
                        <div className="meta mt-0.5">
                          <span className="truncate">
                            {item.roleTitle} ·{' '}
                            {item.reason === 'due' ? `you set ${formatDay(item.followUpOn)}` : `no update since ${formatDate(item.lastActivityAt)}`}
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center gap-1">
                          <Button variant="ink" className="flex-1 text-sm" disabled={quick.isPending} onClick={() => snooze(item, 7)}>
                            <Icon name="check" />
                            Followed up · snooze 7d
                          </Button>
                          <button type="button" className="iconbtn" aria-label={`More options for ${item.companyName}`} onClick={() => setMenuFor(item)}>
                            <Icon name="more" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {ghosts.length > 0 && data && (
              <section className="pt-1">
                <SectionLabel count={ghosts.length} className="pt-5">
                  Might be ghosted
                </SectionLabel>
                <div className="flex flex-col gap-2.5 px-4">
                  {ghosts.map((item) => (
                    <article key={item.id} className="card bg-transparent shadow-[inset_0_0_0_1px_var(--line-strong)]">
                      <Link to={`/applications/${item.id}`} className="r1">
                        <span className="co">{item.companyName}</span>
                        <StatusPill status={item.status} />
                      </Link>
                      <div className="meta mt-0.5">
                        <span className="truncate">
                          {item.roleTitle}
                          {item.appliedOn && ` · applied ${formatDate(item.appliedOn)}`}
                        </span>
                      </div>
                      <p className="mt-2.5 text-[15px] leading-[21px] font-medium">
                        No update in {item.daysSinceActivity} days. Mark as <StatusPill status="ghosted" className="align-[1px]" />?
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          className="flex-1"
                          disabled={quick.isPending}
                          onClick={() =>
                            quick.mutate(
                              { id: item.id, status: 'ghosted' },
                              { onSuccess: () => toast({ message: `${item.companyName} marked Ghosted`, tone: 'info' }), onError },
                            )
                          }
                        >
                          Mark ghosted
                        </Button>
                        <Button variant="quiet" className="flex-1" onClick={() => dismissGhost(item)}>
                          Not yet
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.companyName ?? ''}>
        {menuFor && (
          <div className="pb-2">
            {[3, 14].map((d) => (
              <button
                key={d}
                type="button"
                className="opt-row w-full text-left"
                onClick={() => {
                  snooze(menuFor, d);
                  setMenuFor(null);
                }}
              >
                <Icon name="clock" className="text-ink-3" />
                Followed up · snooze {d} days
                <span className="hint ml-auto">{formatDay(isoDateFromToday(d))}</span>
              </button>
            ))}
            {menuFor.jobUrl && (
              <a href={menuFor.jobUrl} target="_blank" rel="noreferrer" className="opt-row" onClick={() => setMenuFor(null)}>
                <Icon name="external" className="text-ink-3" />
                Open job posting
              </a>
            )}
            <Link to={`/applications/${menuFor.id}`} className="opt-row" onClick={() => setMenuFor(null)}>
              <Icon name="chevronRight" className="text-ink-3" />
              Open application
            </Link>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/**
 * Empty inbox. Numbers and "Next one" come from GET /api/stats (week = Monday 00:00 in the
 * user's timezone; next follow-up uses the same rules as the Follow-ups list).
 */
function AllClear(_props: { settings: FollowUps['settings'] }) {
  const { data: counts } = useStats();
  const stats = useMemo(() => {
    const n = counts?.nextFollowUp;
    return {
      next: n ? { companyName: n.companyName, followUpOn: n.date } : undefined,
      appliedWeek: counts?.appliedThisWeek ?? 0,
      active: counts?.active ?? 0,
      interviews: counts?.interviews ?? 0,
    };
  }, [counts]);

  return (
    <div className="flex flex-col items-center px-8 pt-16 pb-10 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full text-ok shadow-[inset_0_0_0_1.5px_var(--line-strong)]">
        <Icon name="check" size="lg" />
      </div>
      <h2 className="h2 mt-5">Nothing needs you today</h2>
      <p className="mt-2 text-[15px] leading-[22px] text-ink-2">
        No reviews, follow-ups or ghost checks.
        {stats.next && (
          <>
            {' '}
            Next one: <b className="font-semibold text-ink">{stats.next.companyName}</b>, {formatDay(stats.next.followUpOn)}.
          </>
        )}
      </p>
      {counts && (
        <dl className="mt-7 grid w-full max-w-sm grid-cols-3 pt-4 shadow-[inset_0_1px_0_var(--line)]">
          {(
            [
              ['This week', stats.appliedWeek, 'applied'],
              ['In play', stats.active, 'active'],
              ['Interviews', stats.interviews, 'now'],
            ] as const
          ).map(([k, v, unit]) => (
            <div key={k}>
              <dt className="hint">{k}</dt>
              <dd className="num m-0 mt-0.5 text-[22px] leading-7 font-semibold">{v}</dd>
              <div className="hint">{unit}</div>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
