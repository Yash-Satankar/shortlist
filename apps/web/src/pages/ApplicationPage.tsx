import { APPLICATION_SOURCE_LABELS, APPLICATION_STATUSES, STATUS_LABELS, WORK_MODE_LABELS, WORK_MODES, type ApplicationStatus } from '@jt/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  useAddJd,
  useApplication,
  useChangeStatus,
  useDeleteApplication,
  useLibrary,
  useReplaceAnswers,
  useReview,
  useUndo,
  useUpdateApplication,
} from '../api/hooks';
import type { ApplicationDetail, TimelineEvent } from '../api/types';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Layout';
import { Button, buttonClass, Card, EmptyState, ErrorNote, Field, inputClass, Sheet, Spinner, StatusBadge, useToast } from '../components/ui';
import { EVENT_SOURCE_LABELS, formatDate, formatEventTime, REASON_LABELS, relativeDays } from '../lib/format';

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'jd', label: 'JD' },
  { id: 'qa', label: 'Q&A' },
  { id: 'details', label: 'Details' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ApplicationPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'timeline') as TabId;
  const { data: app, isPending, error } = useApplication(id);
  const [statusOpen, setStatusOpen] = useState(false);

  const back = (
    <Link to="/" className="-ml-2 rounded-lg p-1.5 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Back to applications">
      <Icon name="back" />
    </Link>
  );

  if (isPending) {
    return (
      <>
        <PageHeader title="" back={back} />
        <Spinner />
      </>
    );
  }
  if (!app) {
    return (
      <>
        <PageHeader title="Not found" back={back} />
        <main className="mx-auto max-w-3xl p-4">
          <ErrorNote error={error} />
        </main>
      </>
    );
  }

  const pending = app.timeline.filter((e) => e.disposition === 'pending_review').length;

  return (
    <>
      <PageHeader title={app.company?.name ?? 'Application'} back={back}>
        <p className="text-sm text-slate-700 dark:text-slate-300">{app.roleTitle}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            className="inline-flex items-center gap-1 rounded-full focus:ring-2 focus:ring-slate-300 focus:outline-none"
            aria-label={`Status: ${STATUS_LABELS[app.status]}. Change status`}
          >
            <StatusBadge status={app.status} className="py-1 text-sm" />
            <Icon name="chevron" className="h-4 w-4 text-slate-500" />
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {app.appliedOn ? `Applied ${formatDate(app.appliedOn)}` : 'Not applied yet'} · updated {relativeDays(app.lastActivityAt)}
          </span>
          {app.jobUrl && (
            <a href={app.jobUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-sm text-sky-700 dark:text-sky-400">
              Posting <Icon name="external" className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        <nav className="-mb-3 mt-3 flex gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}
              className={`border-b-2 px-3 pb-2 text-sm font-medium ${
                tab === t.id ? 'border-slate-900 text-slate-900 dark:border-slate-100 dark:text-white' : 'border-transparent text-slate-500'
              }`}
            >
              {t.label}
              {t.id === 'timeline' && pending > 0 && <span className="ml-1 text-amber-600">●</span>}
              {t.id === 'qa' && app.answers.length > 0 && <span className="ml-1 text-xs text-slate-400">{app.answers.length}</span>}
            </button>
          ))}
        </nav>
      </PageHeader>

      <main className="mx-auto max-w-3xl px-4 py-4">
        {tab === 'timeline' && <TimelineTab app={app} />}
        {tab === 'jd' && <JdTab app={app} />}
        {tab === 'qa' && <QaTab app={app} />}
        {tab === 'details' && <DetailsTab app={app} />}
      </main>

      <StatusSheet app={app} open={statusOpen} onClose={() => setStatusOpen(false)} />
    </>
  );
}

// ---------------------------------------------------------------- status

function StatusSheet({ app, open, onClose }: { app: ApplicationDetail; open: boolean; onClose: () => void }) {
  const change = useChangeStatus(app.id);
  const undo = useUndo(app.id);
  const toast = useToast();

  const pick = (status: ApplicationStatus) => {
    if (status === app.status) return onClose();
    change.mutate(
      { status },
      {
        onSuccess: ({ application }) => {
          onClose();
          const latest = latestEffective(application.timeline);
          toast({
            message: `Moved to ${STATUS_LABELS[status]}`,
            tone: 'info',
            action: latest ? { label: 'Undo', run: () => undo.mutate(latest.id) } : undefined,
          });
        },
        onError: (err) => toast({ message: err.message, tone: 'error' }),
      },
    );
  };

  return (
    <Sheet open={open} onClose={onClose} title="Change status">
      <ul className="grid grid-cols-2 gap-2">
        {APPLICATION_STATUSES.map((s) => (
          <li key={s}>
            <button
              type="button"
              disabled={change.isPending}
              onClick={() => pick(s)}
              className={`w-full rounded-lg border px-3 py-3 text-left text-sm font-medium ${
                s === app.status ? 'border-slate-900 ring-1 ring-slate-900 dark:border-slate-100 dark:ring-slate-100' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <StatusBadge status={s} />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** The change "Undo" would revert: newest applied, not-yet-reverted event with a previous status. */
function latestEffective(timeline: TimelineEvent[]): TimelineEvent | undefined {
  const effective = timeline
    .filter((e) => e.disposition === 'applied' && !e.revertedAt)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.occurredAt.localeCompare(a.occurredAt));
  const latest = effective[0];
  return latest?.fromStatus ? latest : undefined;
}

// ---------------------------------------------------------------- timeline

function TimelineTab({ app }: { app: ApplicationDetail }) {
  const undo = useUndo(app.id);
  const review = useReview(app.id);
  const toast = useToast();
  const onError = (err: Error) => toast({ message: err.message, tone: 'error' });

  const undoable = latestEffective(app.timeline);
  const events = useMemo(
    () => [...app.timeline].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.recordedAt.localeCompare(a.recordedAt)),
    [app.timeline],
  );

  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-5 dark:border-slate-800">
      {events.map((e) => {
        const muted = e.disposition === 'ignored' || e.disposition === 'dismissed' || !!e.revertedAt;
        return (
          <li key={e.id} className="relative">
            <span
              className={`absolute top-4 -left-[1.6rem] h-2.5 w-2.5 rounded-full ring-4 ring-slate-50 dark:ring-slate-950 ${
                e.disposition === 'pending_review' ? 'bg-amber-500' : muted ? 'bg-slate-300 dark:bg-slate-700' : 'bg-slate-900 dark:bg-slate-100'
              }`}
            />
            <Card className={`p-3 ${e.disposition === 'pending_review' ? 'border-amber-300 dark:border-amber-800' : ''} ${muted ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {e.fromStatus ? (
                  <>
                    <StatusBadge status={e.fromStatus} />
                    <span className="text-slate-400">→</span>
                  </>
                ) : (
                  <span className="text-slate-500">Created as</span>
                )}
                <StatusBadge status={e.toStatus} className={e.disposition === 'dismissed' ? 'line-through' : ''} />
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {formatEventTime(e.occurredAt)} · {EVENT_SOURCE_LABELS[e.source]}
                {e.confidence && ` · ${e.confidence} confidence`}
                {e.revertsEventId && ' · undo'}
                {e.revertedAt && ' · undone'}
                {e.disposition === 'dismissed' && ' · dismissed'}
              </p>
              {e.reason && REASON_LABELS[e.reason] && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{REASON_LABELS[e.reason]}</p>}
              {e.note && e.note !== 'Undo' && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{e.note}</p>}

              {e.disposition === 'pending_review' && (
                <div className="mt-2 flex gap-2">
                  <Button variant="primary" size="sm" disabled={review.isPending} onClick={() => review.mutate({ eventId: e.id, decision: 'accept' }, { onError })}>
                    <Icon name="check" className="h-4 w-4" /> Accept
                  </Button>
                  <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ eventId: e.id, decision: 'dismiss' }, { onError })}>
                    Dismiss
                  </Button>
                </div>
              )}
              {undoable?.id === e.id && (
                <div className="mt-2">
                  <Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => undo.mutate(e.id, { onError })}>
                    <Icon name="undo" className="h-4 w-4" /> Undo
                  </Button>
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- JD

function JdTab({ app }: { app: ApplicationDetail }) {
  const add = useAddJd(app.id);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const save = (e: FormEvent) => {
    e.preventDefault();
    add.mutate(text.trim(), {
      onSuccess: () => {
        setEditing(false);
        setText('');
        toast({ message: 'JD saved', tone: 'info' });
      },
    });
  };

  if (editing || !app.jd) {
    return (
      <form onSubmit={save} className="space-y-3">
        {!app.jd && <p className="text-sm text-slate-600 dark:text-slate-400">No JD saved yet. Paste it here so it's kept even if the posting disappears.</p>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          placeholder="Paste the full job description…"
          className={`${inputClass} font-mono text-sm`}
          aria-label="Job description"
        />
        <ErrorNote error={add.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={!text.trim() || add.isPending}>
            Save JD
          </Button>
          {app.jd && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
        {app.jd && <p className="text-xs text-slate-500">The previous version is kept in the history.</p>}
      </form>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>
          Captured {formatDate(app.jd.capturedAt)} · {EVENT_SOURCE_LABELS[app.jd.source]}
          {app.jdHistory.length > 1 && ` · ${app.jdHistory.length} versions`}
        </span>
        <span className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigator.clipboard.writeText(app.jd!.content).then(() => toast({ message: 'Copied', tone: 'info' }))}
          >
            <Icon name="copy" className="h-4 w-4" /> Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Icon name="edit" className="h-4 w-4" /> Update
          </Button>
        </span>
      </div>
      <Card className="p-4">
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{app.jd.content}</div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Q&A

type DraftAnswer = { question: string; answer: string; libraryItemId: string | null };

function QaTab({ app }: { app: ApplicationDetail }) {
  const save = useReplaceAnswers(app.id);
  const toast = useToast();
  const [draft, setDraft] = useState<DraftAnswer[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const startEdit = () => setDraft(app.answers.map(({ question, answer, libraryItemId }) => ({ question, answer, libraryItemId })));

  if (!draft) {
    return (
      <div className="space-y-3">
        {app.answers.length === 0 ? (
          <EmptyState title="No screening answers saved">Record what you told this company (CTC, notice period, years of Node.js…).</EmptyState>
        ) : (
          <dl className="space-y-2">
            {app.answers.map((a) => (
              <Card key={a.id} className="p-3">
                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{a.question}</dt>
                <dd className="mt-0.5 text-sm whitespace-pre-wrap">{a.answer || '—'}</dd>
              </Card>
            ))}
          </dl>
        )}
        <Button onClick={startEdit}>
          <Icon name="edit" className="h-4 w-4" /> {app.answers.length ? 'Edit answers' : 'Add answers'}
        </Button>
      </div>
    );
  }

  const update = (i: number, patch: Partial<DraftAnswer>) => setDraft((d) => d!.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const valid = draft.filter((a) => a.question.trim());

  return (
    <div className="space-y-3">
      {draft.map((row, i) => (
        <Card key={i} className="space-y-2 p-3">
          <input
            value={row.question}
            onChange={(e) => update(i, { question: e.target.value, libraryItemId: null })}
            placeholder="Question"
            className={`${inputClass} text-sm`}
            aria-label={`Question ${i + 1}`}
          />
          <textarea
            value={row.answer}
            onChange={(e) => update(i, { answer: e.target.value })}
            placeholder="What you answered"
            rows={2}
            className={`${inputClass} text-sm`}
            aria-label={`Answer ${i + 1}`}
          />
          <button type="button" className="text-xs text-rose-600" onClick={() => setDraft((d) => d!.filter((_, j) => j !== i))}>
            Remove
          </button>
        </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDraft((d) => [...d!, { question: '', answer: '', libraryItemId: null }])}>
          <Icon name="plus" className="h-4 w-4" /> Add question
        </Button>
        <Button size="sm" onClick={() => setLibraryOpen(true)}>
          From my standard answers
        </Button>
      </div>
      <ErrorNote error={save.error} />
      <div className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              valid.map((a) => ({ question: a.question.trim(), answer: a.answer.trim(), libraryItemId: a.libraryItemId })),
              { onSuccess: () => (setDraft(null), toast({ message: 'Answers saved', tone: 'info' })) },
            )
          }
        >
          Save
        </Button>
        <Button variant="ghost" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
      <LibraryPicker
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        exclude={new Set(draft.map((d) => d.question.trim().toLowerCase()))}
        onPick={(item) => setDraft((d) => [...d!, item])}
      />
    </div>
  );
}

function LibraryPicker({
  open,
  onClose,
  exclude,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  exclude: Set<string>;
  onPick: (a: DraftAnswer) => void;
}) {
  const library = useLibrary();
  const items = (library.data ?? []).filter((i) => !exclude.has(i.question.toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title="Standard answers">
      {library.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing left to add" />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="w-full py-2.5 text-left"
                onClick={() => onPick({ question: item.question, answer: item.answer, libraryItemId: item.origin === 'library' ? item.id : null })}
              >
                <span className="block text-sm font-medium">
                  {item.question}
                  {item.origin === 'profile' && <span className="ml-1.5 text-xs font-normal text-slate-500">profile</span>}
                </span>
                <span className="block text-sm text-slate-600 dark:text-slate-400">{item.answer}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- details

function DetailsTab({ app }: { app: ApplicationDetail }) {
  const update = useUpdateApplication(app.id);
  const del = useDeleteApplication(app.id);
  const navigate = useNavigate();
  const toast = useToast();

  const initial = {
    companyName: app.company?.name ?? '',
    roleTitle: app.roleTitle,
    location: app.location ?? '',
    workMode: app.workMode,
    workModeDetail: app.workModeDetail ?? '',
    experienceAsked: app.experienceAsked ?? '',
    jobUrl: app.jobUrl ?? '',
    appliedOn: app.appliedOn ?? '',
    followUpOn: app.followUpOn ?? '',
    salaryListed: app.salaryListed ?? '',
    expectedCtc: app.expectedCtc ?? '',
    notes: app.notes ?? '',
  };
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const changed = Object.fromEntries(
    Object.entries(form)
      .filter(([k, v]) => v !== initial[k as keyof typeof initial])
      .map(([k, v]) => [k, v === '' && !['companyName', 'roleTitle'].includes(k) ? null : v]),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(changed, { onSuccess: () => toast({ message: 'Saved', tone: 'info' }) });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company">
          <input className={inputClass} value={form.companyName} onChange={set('companyName')} required />
        </Field>
        <Field label="Role">
          <input className={inputClass} value={form.roleTitle} onChange={set('roleTitle')} required />
        </Field>
        <Field label="Location">
          <input className={inputClass} value={form.location} onChange={set('location')} />
        </Field>
        <Field label="Work mode">
          <select className={inputClass} value={form.workMode} onChange={set('workMode')}>
            {WORK_MODES.map((m) => (
              <option key={m} value={m}>
                {WORK_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Experience asked">
          <input className={inputClass} value={form.experienceAsked} onChange={set('experienceAsked')} placeholder="e.g. 2–5 yrs" />
        </Field>
        <Field label="Salary listed">
          <input className={inputClass} value={form.salaryListed} onChange={set('salaryListed')} placeholder="e.g. 10–15 LPA" />
        </Field>
        <Field label="Applied on">
          <input type="date" className={inputClass} value={form.appliedOn} onChange={set('appliedOn')} />
        </Field>
        <Field label="Follow up on" hint="Overrides the automatic follow-up reminder">
          <input type="date" className={inputClass} value={form.followUpOn} onChange={set('followUpOn')} />
        </Field>
        <Field label="Expected CTC I gave" hint="Encrypted">
          <input className={inputClass} value={form.expectedCtc} onChange={set('expectedCtc')} placeholder="e.g. 12 LPA" />
        </Field>
        <Field label="Job link">
          <input type="url" inputMode="url" className={inputClass} value={form.jobUrl} onChange={set('jobUrl')} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={inputClass} rows={4} value={form.notes} onChange={set('notes')} />
      </Field>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Source: {APPLICATION_SOURCE_LABELS[app.source]}
        {app.sourceDetail && ` (${app.sourceDetail})`}
      </p>

      <ErrorNote error={update.error ?? del.error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={!Object.keys(changed).length || update.isPending}>
          Save changes
        </Button>
        <Button
          variant="ghost"
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { archived: !app.archivedAt },
              { onSuccess: () => toast({ message: app.archivedAt ? 'Unarchived' : 'Archived', tone: 'info' }) },
            )
          }
        >
          {app.archivedAt ? 'Unarchive' : 'Archive'}
        </Button>
        <Button
          variant="danger"
          className="ml-auto"
          disabled={del.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${app.company?.name} — ${app.roleTitle}? This removes its timeline, JD and answers.`)) {
              del.mutate(undefined, { onSuccess: () => navigate('/', { replace: true }) });
            }
          }}
        >
          <Icon name="trash" className="h-4 w-4" /> Delete
        </Button>
      </div>
      {app.jobUrl && (
        <a href={app.jobUrl} target="_blank" rel="noreferrer" className={buttonClass('ghost', 'sm')}>
          Open job posting <Icon name="external" className="h-4 w-4" />
        </a>
      )}
    </form>
  );
}
