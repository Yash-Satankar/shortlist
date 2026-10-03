import { FOLLOW_UP_REASON_LABELS, STATUS_LABELS } from '@jt/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useFollowUps, useQuickUpdate, useReviewAny, useReviews } from '../api/hooks';
import type { FollowUpItem } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Button, buttonClass, Card, EmptyState, ErrorNote, Spinner, StatusBadge, useToast } from '../components/ui';
import { EVENT_SOURCE_LABELS, formatDate, isoDateFromToday, REASON_LABELS } from '../lib/format';

/** Everything that needs me: flagged automatic changes, follow-ups, and possible ghosting. */
export function FollowUpsPage() {
  const followUps = useFollowUps();
  const reviews = useReviews();
  const review = useReviewAny();
  const quick = useQuickUpdate();
  const toast = useToast();

  const onError = (err: unknown) => toast({ message: err instanceof Error ? err.message : 'Failed', tone: 'error' });

  if (followUps.isPending || reviews.isPending) {
    return (
      <>
        <PageHeader title="Follow-ups" />
        <Spinner />
      </>
    );
  }

  const data = followUps.data;
  const empty = !reviews.data?.length && !data?.followUps.length && !data?.ghostSuggestions.length;

  return (
    <>
      <PageHeader title="Follow-ups" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-4">
        <ErrorNote error={followUps.error ?? reviews.error} />
        {empty && <EmptyState title="All caught up">Nothing needs a follow-up right now.</EmptyState>}

        {!!reviews.data?.length && (
          <Section title="Needs review" hint="Automatic updates that weren't applied on their own">
            {reviews.data.map(({ event, application, company }) => (
              <Card key={event.id} className="border-amber-300 p-4 dark:border-amber-800">
                <ItemHeader id={application.id} company={company.name} role={application.roleTitle} />
                <p className="mt-2 text-sm">
                  {EVENT_SOURCE_LABELS[event.source]} says <strong>{STATUS_LABELS[event.toStatus]}</strong>
                  {' · '}currently <strong>{STATUS_LABELS[application.status]}</strong>
                </p>
                {event.reason && <p className="text-xs text-amber-700 dark:text-amber-400">{REASON_LABELS[event.reason] ?? event.reason}</p>}
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ applicationId: application.id, eventId: event.id, decision: 'accept' }, { onError })}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ applicationId: application.id, eventId: event.id, decision: 'dismiss' }, { onError })}
                  >
                    Dismiss
                  </Button>
                </div>
              </Card>
            ))}
          </Section>
        )}

        {!!data?.followUps.length && (
          <Section title="Follow up" hint={`No reply after ${data.settings.followUpAfterDays} days, ${data.settings.postInterviewFollowUpDays} days after an interview, or your follow-up date`}>
            {data.followUps.map((item) => (
              <Card key={item.id} className="p-4">
                <ItemHeader id={item.id} company={item.companyName} role={item.roleTitle} status={item.status} />
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{FOLLOW_UP_REASON_LABELS[item.reason]}</span>
                  {' · '}
                  {item.reason === 'due' ? `due ${formatDate(item.followUpOn)}` : `${item.daysSinceActivity} days without an update`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.jobUrl && (
                    <a href={item.jobUrl} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
                      Open posting
                    </a>
                  )}
                  <SnoozeButton item={item} days={7} onError={onError} />
                </div>
              </Card>
            ))}
          </Section>
        )}

        {!!data?.ghostSuggestions.length && (
          <Section title="Might be ghosted" hint={`No activity for ${data.settings.ghostAfterDays}+ days. You decide.`}>
            {data.ghostSuggestions.map((item) => (
              <Card key={item.id} className="p-4">
                <ItemHeader id={item.id} company={item.companyName} role={item.roleTitle} status={item.status} />
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{item.daysSinceActivity} days without activity</p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
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
                </div>
              </Card>
            ))}
          </Section>
        )}
      </main>
    </>
  );
}

function SnoozeButton({ item, days, onError }: { item: FollowUpItem; days: number; onError: (e: unknown) => void }) {
  const quick = useQuickUpdate();
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={quick.isPending}
      onClick={() =>
        quick.mutate(
          { id: item.id, patch: { followUpOn: isoDateFromToday(days) } },
          { onSuccess: () => toast({ message: `Snoozed until ${formatDate(isoDateFromToday(days))}`, tone: 'info' }), onError },
        )
      }
    >
      Followed up · snooze {days}d
    </Button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ItemHeader({ id, company, role, status }: { id: string; company: string; role: string; status?: Parameters<typeof StatusBadge>[0]['status'] }) {
  return (
    <Link to={`/applications/${id}`} className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate font-semibold">{company}</p>
        <p className="truncate text-sm text-slate-700 dark:text-slate-300">{role}</p>
      </div>
      {status && <StatusBadge status={status} />}
    </Link>
  );
}
