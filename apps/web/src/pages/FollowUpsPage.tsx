import { PORTAL_SITE_LABELS, type ApplicationStatus, type FollowUpReason } from '@jt/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApplications, useAssignEmail, useCheckEmail, useDismissEmail, useEmailStatus, useFeature, useFollowUps, usePortalPending, usePortalReview, useQuickUpdate, useReviewAny, useReviews, useStats, useUnmatchedEmails, type PortalProposal, type UnmatchedEmail } from '../api/hooks';
import type { FollowUpItem, FollowUps } from '../api/types';
import { Icon, type IconName } from '../components/Icon';
import { ScreenHeader } from '../components/Layout';
import { Button, buttonClass, Confidence, ErrorNote, EventSourceBadge, SectionLabel, Sheet, SkeletonRows, StatusPill, useToast } from '../components/ui';
import { formatDate, formatDay, formatEventTime, isoDateFromToday, REASON_LABELS, shortAge } from '../lib/format';
import { dismissGhost, useVisibleGhosts } from '../lib/ghost';
import { mailboxProblem } from './settings/EmailSection';

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
  const portal = usePortalPending();
  const emailOn = useFeature('email_intake');
  const unmatched = useUnmatchedEmails(emailOn === true);
  const mailbox = useEmailStatus(emailOn === true).data?.mailbox;
  const mailboxAlert = mailbox?.needsAttention ? mailbox : null;
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

  const total = (reviews.data?.length ?? 0) + (portal.data?.length ?? 0) + (unmatched.data?.length ?? 0) + (data?.followUps.length ?? 0) + ghosts.length + (mailboxAlert ? 1 : 0);
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
            {mailboxAlert && <MailboxAlert mailbox={mailboxAlert} onError={onError} />}
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

            {!!portal.data?.length && <PortalSyncSection items={portal.data} onError={onError} />}

            {!!unmatched.data?.length && <EmailsToMatch items={unmatched.data} onError={onError} />}

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

/** The job mailbox keeps failing, or hasn't been read for a while: say so here, not only in Settings. */
function MailboxAlert({ mailbox, onError }: { mailbox: NonNullable<NonNullable<ReturnType<typeof useEmailStatus>['data']>['mailbox']>; onError: (err: unknown) => void }) {
  const check = useCheckEmail();
  const toast = useToast();
  return (
    <section>
      <SectionLabel action="From your email">Email updates</SectionLabel>
      <div className="px-4">
        <article className="card pt-3.5 pb-3">
          <div className="flex items-center gap-2 text-[15px] leading-5 font-semibold">
            <Icon name="inbox" className="text-danger" />
            Your job mailbox isn’t being read
          </div>
          <div className="ev-time mt-1 text-danger">{mailboxProblem(mailbox)}</div>
          <p className="hint m-0 mt-2">{mailbox.address} · new job emails won’t update your applications until this is fixed.</p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="ink"
              className="flex-1"
              disabled={check.isPending}
              onClick={() => check.mutate(undefined, { onSuccess: () => toast({ message: 'Checking your mailbox…', tone: 'info' }), onError })}
            >
              Check now
            </Button>
            <Link to="/settings" className={`${buttonClass('secondary', 'md')} flex-1`}>
              Settings
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}

/**
 * Portal sync proposals: statuses read from a job portal's applications list (by the extension,
 * on a site you switched on). Nothing changes until you accept; accepted changes go through the
 * normal rules and land on the timeline with the portal's own label.
 */
function PortalSyncSection({ items, onError }: { items: PortalProposal[]; onError: (err: unknown) => void }) {
  const decide = usePortalReview();
  const toast = useToast();
  const run = (body: { accept?: string[]; dismiss?: string[] }) =>
    decide.mutate(body, {
      onSuccess: ({ results }) => {
        const n = results.filter((r) => r.outcome !== 'dismissed').length;
        if (n) toast({ message: n === 1 ? 'Change applied' : `${n} changes applied`, tone: 'info' });
      },
      onError,
    });
  const site = PORTAL_SITE_LABELS[items[0]!.site];

  return (
    <section className="pt-1">
      <SectionLabel
        count={items.length}
        className="pt-5"
        action={
          items.length > 1 ? (
            <button type="button" className="font-[inherit] text-ink-2 underline-offset-2 hover:underline" disabled={decide.isPending} onClick={() => run({ accept: items.map((i) => i.id) })}>
              Accept all
            </button>
          ) : (
            'From your portals'
          )
        }
      >
        Portal sync
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        {items.map((p) => (
          <article key={p.id} className="card pt-3.5 pb-3">
            {p.applicationId ? (
              <Link to={`/applications/${p.applicationId}`} className="flex items-baseline gap-2">
                <span className="co flex-none">{p.companyName}</span>
                <span className="role m-0 text-[13px]">{p.roleTitle}</span>
              </Link>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="co flex-none">{p.companyName}</span>
                <span className="role m-0 text-[13px]">{p.roleTitle}</span>
              </div>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              {p.currentStatus ? <StatusPill status={p.currentStatus} /> : <span className="src">not tracked yet</span>}
              <Icon name="arrowRight" size="sm" className="text-ink-3" />
              <StatusPill status={p.proposedStatus} />
            </div>
            <div className="ev-m mt-2">
              <EventSourceBadge source="portal" />
              <span className="ev-time">{PORTAL_SITE_LABELS[p.site] ?? site}</span>
              {p.matchedBy === 'company_role' && <span className="ev-time">· matched by company and role</span>}
            </div>
            <p className="mt-2 text-[13px] leading-[19px] text-ink-2 italic">
              “{p.rawLabel}”{p.meaning && p.meaning.toLowerCase() !== p.rawLabel.toLowerCase() ? ` · ${p.meaning}` : ''}
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="ink" className="flex-1" disabled={decide.isPending} onClick={() => run({ accept: [p.id] })}>
                <Icon name="check" />
                {p.kind === 'new' ? 'Save and accept' : 'Accept'}
              </Button>
              <Button className="flex-1" disabled={decide.isPending} onClick={() => run({ dismiss: [p.id] })}>
                Dismiss
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const EMAIL_STATUS: Record<UnmatchedEmail['category'], ApplicationStatus> = {
  received: 'applied',
  viewed: 'viewed',
  assessment: 'assessment',
  interview: 'interview',
  rejected: 'rejected',
  offer: 'offer',
};

/**
 * Job emails the tracker couldn't tie to one application (e.g. two roles at the same company).
 * Picking the application proposes the change through the normal rules; nothing changes before.
 */
function EmailsToMatch({ items, onError }: { items: UnmatchedEmail[]; onError: (err: unknown) => void }) {
  const apps = useApplications(useMemo(() => new URLSearchParams({ archived: 'false' }), []));
  const assign = useAssignEmail();
  const dismiss = useDismissEmail();
  const toast = useToast();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const options = useMemo(
    () => [...(apps.data?.items ?? [])].sort((a, b) => a.companyName.localeCompare(b.companyName) || a.roleTitle.localeCompare(b.roleTitle)),
    [apps.data],
  );

  return (
    <section className="pt-1">
      <SectionLabel count={items.length} className="pt-5" action="From your email">
        Emails to match
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        {items.map((m) => (
          <article key={m.id} className="card pt-3.5 pb-3">
            <div className="truncate text-[15px] leading-5 font-semibold">{m.subject}</div>
            <div className="ev-time mt-1 truncate">
              {m.from} · {formatEventTime(m.receivedAt)}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="src">email says</span>
              <Icon name="arrowRight" size="sm" className="text-ink-3" />
              <StatusPill status={EMAIL_STATUS[m.category]} />
            </div>
            <label className="field mt-3">
              <span className="lbl">Which application is this about?</span>
              <select className="inp" value={choice[m.id] ?? ''} onChange={(e) => setChoice((c) => ({ ...c, [m.id]: e.target.value }))}>
                <option value="">Choose…</option>
                {options.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.companyName} · {a.roleTitle}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-3 flex gap-2">
              <Button
                variant="ink"
                className="flex-1"
                disabled={!choice[m.id] || assign.isPending}
                onClick={() =>
                  assign.mutate(
                    { emailId: m.id, applicationId: choice[m.id]! },
                    { onSuccess: (r) => toast({ message: r.outcome === 'applied' ? 'Status updated' : r.outcome === 'review' ? 'Sent to review' : 'Matched', tone: 'info' }), onError },
                  )
                }
              >
                <Icon name="check" />
                Assign
              </Button>
              <Button className="flex-1" disabled={dismiss.isPending} onClick={() => dismiss.mutate(m.id, { onError })}>
                Dismiss
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
