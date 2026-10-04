import { APPLICATION_SOURCE_LABELS, STATUS_LABELS, WORK_MODE_LABELS, WORK_MODES, type ApplicationStatus, type WorkMode } from '@jt/shared';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  useAddJd,
  useApplication,
  useChangeStatus,
  useDeleteApplication,
  useLibrary,
  useReplaceAnswers,
  useReview,
  useSaveRecruiter,
  useUndo,
  useUpdateApplication,
} from '../api/hooks';
import type { ApplicationDetail, TimelineEvent } from '../api/types';
import { Icon } from '../components/Icon';
import {
  Button,
  Confidence,
  EmptyState,
  ErrorNote,
  EventSourceBadge,
  Field,
  IconButton,
  Segmented,
  Sheet,
  Spinner,
  StatusButton,
  StatusGlyph,
  StatusPill,
  useToast,
} from '../components/ui';
import { EVENT_SOURCE_LABELS, formatDate, formatDateTime, formatEventTime, REASON_LABELS } from '../lib/format';
import { STATUS_GROUPS, STATUS_HINT, STATUS_SHORT } from '../lib/status';
import { latestEffective } from '../lib/timeline';

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'jd', label: 'JD' },
  { id: 'qa', label: 'Q&A' },
  { id: 'details', label: 'Details' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ApplicationPage() {
  const { id = '' } = useParams();
  const { data: app, isPending, error } = useApplication(id);

  if (isPending) return <Spinner />;
  if (!app) {
    return (
      <div className="pt-safe p-4">
        <BackLink />
        <ErrorNote error={error ?? new Error('Application not found')} />
      </div>
    );
  }
  // Keyed so switching applications in the desktop split resets tab-local drafts.
  return <Detail key={app.id} app={app} />;
}

function BackLink() {
  return (
    <Link to="/" className="iconbtn md:hidden" aria-label="Back to Applications">
      <Icon name="back" />
    </Link>
  );
}

function salaryText(app: ApplicationDetail): string {
  if (app.salaryListed) return app.salaryListed;
  if (app.salaryMinLpa != null && app.salaryMaxLpa != null) return `${app.salaryMinLpa}–${app.salaryMaxLpa} LPA`;
  if (app.salaryMinLpa != null) return `${app.salaryMinLpa}+ LPA`;
  if (app.salaryMaxLpa != null) return `up to ${app.salaryMaxLpa} LPA`;
  return '—';
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

function Detail({ app }: { app: ApplicationDetail }) {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'timeline') as TabId;
  const [statusOpen, setStatusOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // Compact title bar (phones) once the full header has scrolled away.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry && setCompact(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const company = app.company?.name ?? 'Application';
  const pending = app.timeline.filter((e) => e.disposition === 'pending_review').length;
  const timelineCount = app.timeline.filter((e) => !e.revertsEventId).length;
  const workMode = app.workMode !== 'unknown' ? WORK_MODE_LABELS[app.workMode] + (app.workModeDetail ? ` (${app.workModeDetail})` : '') : '—';

  return (
    <div className="pt-safe md:pt-0">
      {/* Top bar */}
      <div className="flex min-h-12 items-center gap-2 px-1 md:px-4 md:pt-2.5 md:pl-6">
        <BackLink />
        <span className="ev-time hidden md:inline">
          <Link to="/" className="hover:underline">
            Applications
          </Link>{' '}
          / {company}
        </span>
        <span className="sp" />
        {app.jobUrl && (
          <a className="iconbtn md:hidden" href={app.jobUrl} target="_blank" rel="noreferrer" aria-label="Open job posting">
            <Icon name="external" />
          </a>
        )}
        {app.jobUrl && (
          <a className="btn btn-sec btn-sm hidden md:inline-flex" href={app.jobUrl} target="_blank" rel="noreferrer">
            Open posting
            <Icon name="external" size="sm" />
          </a>
        )}
        <IconButton icon="more" label="More actions" onClick={() => setMenuOpen(true)} className="md:h-9 md:w-9" />
      </div>

      {/* Full header */}
      <div className="px-4 pt-0.5 md:px-6 md:pt-1">
        <h1 className="h2 md:text-2xl md:leading-[30px]">{company}</h1>
        <div className="mt-0.5 text-[15px] leading-[21px] text-ink-2">{app.roleTitle}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <StatusButton status={app.status} onClick={() => setStatusOpen(true)} />
          <span className="ev-time">since {formatDate(app.statusChangedAt)}</span>
          {app.archivedAt && <span className="tag ign">Archived</span>}
          {pending > 0 && (
            <button type="button" className="rc ml-auto" onClick={() => setParams({ tab: 'timeline' }, { replace: true })}>
              <span className="mk rev h-2 w-2" />
              {pending} change{pending > 1 ? 's' : ''} awaiting review
            </button>
          )}
        </div>
        <dl className="facts mt-4 md:mt-[18px] md:grid-cols-6 md:py-3 md:shadow-[inset_0_1px_0_var(--line),inset_0_-1px_0_var(--line)]">
          <div>
            <dt>Location</dt>
            <dd title={app.location ?? undefined}>{app.location || '—'}</dd>
          </div>
          <div>
            <dt>Work mode</dt>
            <dd>{workMode}</dd>
          </div>
          <div>
            <dt>Exp asked</dt>
            <dd>{app.experienceAsked || '—'}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd title={app.sourceDetail ?? undefined}>{APPLICATION_SOURCE_LABELS[app.source]}</dd>
          </div>
          <div>
            <dt>Applied</dt>
            <dd>{app.appliedOn ? formatDate(app.appliedOn) : 'Not yet'}</dd>
          </div>
          <div>
            <dt>Salary</dt>
            <dd>{salaryText(app)}</dd>
          </div>
        </dl>
        {app.jobUrl && (
          <a href={app.jobUrl} target="_blank" rel="noreferrer" className="mt-1.5 flex min-h-11 items-center gap-2 text-sm font-medium text-ink-2 md:hidden">
            <Icon name="link" size="sm" />
            <span className="truncate underline decoration-line-strong underline-offset-[3px]">{shortUrl(app.jobUrl)}</span>
            <Icon name="external" size="xs" className="text-ink-3" />
          </a>
        )}
      </div>
      <div ref={sentinel} />

      {/* Sticky: compact header (phones, after scrolling) + tabs */}
      <div className="sticky top-safe z-20 mt-1 bg-bg md:top-0 md:mt-1 md:bg-surface">
        {compact && (
          <div className="flex items-center gap-1 px-1 pb-1 shadow-[0_1px_0_var(--line)] md:hidden">
            <BackLink />
            <div className="min-w-0 flex-1">
              <div className="co text-base">{company}</div>
              <div className="role m-0 text-xs leading-4">{app.roleTitle}</div>
            </div>
            <button type="button" className={`pill btnlike st-${app.status} mr-3 h-7`} onClick={() => setStatusOpen(true)} aria-label={`Status: ${STATUS_SHORT[app.status]}. Change status`}>
              <StatusGlyph />
              {STATUS_SHORT[app.status]}
            </button>
          </div>
        )}
        <nav className="tabs md:px-4" aria-label="Application sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${tab === t.id ? 'on' : ''}`}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setParams(t.id === 'timeline' ? {} : { tab: t.id }, { replace: true })}
            >
              {t.label}
              {t.id === 'timeline' && <span className="n">{timelineCount}</span>}
              {t.id === 'timeline' && pending > 0 && <span className="mk rev h-2 w-2" aria-label={`${pending} pending review`} />}
              {t.id === 'qa' && app.answers.length > 0 && <span className="n">{app.answers.length}</span>}
            </button>
          ))}
        </nav>
      </div>

      <main className="px-4 pt-4 pb-8 md:px-6 md:pt-5">
        {tab === 'timeline' && <TimelineTab app={app} />}
        {tab === 'jd' && <JdTab app={app} />}
        {tab === 'qa' && <QaTab app={app} />}
        {tab === 'details' && <DetailsTab app={app} />}
      </main>

      <StatusSheet app={app} open={statusOpen} onClose={() => setStatusOpen(false)} />
      <ActionsSheet app={app} open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------- status picker

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
            message: (
              <>
                Moved to <b>{STATUS_SHORT[status]}</b>
              </>
            ),
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
      {STATUS_GROUPS.map((g) => (
        <div key={g.id}>
          <div className="sect px-4 pt-2.5 pb-1">{g.label}</div>
          {g.statuses.map((s) => (
            <button
              key={s}
              type="button"
              disabled={change.isPending}
              aria-pressed={s === app.status}
              className={`opt-row w-full text-left ${s === app.status ? 'on' : ''}`}
              onClick={() => pick(s)}
            >
              <StatusPill status={s} />
              <span className="text-[13px] leading-[18px] text-ink-3">{s === app.status ? 'Current' : (STATUS_HINT[s] ?? '')}</span>
              {s === app.status && <Icon name="check" className="ck" />}
            </button>
          ))}
        </div>
      ))}
      <p className="hint px-4 pt-3 pb-2">Logged on the timeline as manual. You can undo it.</p>
    </Sheet>
  );
}

function ActionsSheet({ app, open, onClose }: { app: ApplicationDetail; open: boolean; onClose: () => void }) {
  const update = useUpdateApplication(app.id);
  const del = useDeleteApplication(app.id);
  const navigate = useNavigate();
  const toast = useToast();
  const onError = (err: Error) => toast({ message: err.message, tone: 'error' });

  return (
    <Sheet open={open} onClose={onClose} title={app.company?.name ?? 'Application'}>
      <div className="pb-2">
        {app.jobUrl && (
          <a href={app.jobUrl} target="_blank" rel="noreferrer" className="opt-row" onClick={onClose}>
            <Icon name="external" className="text-ink-3" />
            Open job posting
          </a>
        )}
        <button
          type="button"
          className="opt-row w-full text-left"
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { archived: !app.archivedAt },
              { onSuccess: () => (onClose(), toast({ message: app.archivedAt ? 'Unarchived' : 'Archived', tone: 'info' })), onError },
            )
          }
        >
          <Icon name="file" className="text-ink-3" />
          {app.archivedAt ? 'Unarchive' : 'Archive'}
          <span className="hint ml-auto">hides it from the list</span>
        </button>
        <button
          type="button"
          className="opt-row w-full text-left text-danger"
          disabled={del.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${app.company?.name} — ${app.roleTitle}? This removes its timeline, JD and answers.`)) {
              del.mutate(undefined, { onSuccess: () => navigate('/', { replace: true }), onError });
            }
          }}
        >
          <Icon name="trash" />
          Delete application
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- timeline

function TimelineTab({ app }: { app: ApplicationDetail }) {
  const undo = useUndo(app.id);
  const review = useReview(app.id);
  const toast = useToast();
  const onError = (err: Error) => toast({ message: err.message, tone: 'error' });

  const undoable = latestEffective(app.timeline);
  const events = useMemo(
    () =>
      [...app.timeline]
        .filter((e) => !e.revertsEventId) // an undo shows on the event it reverted ("undone 22:11")
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.recordedAt.localeCompare(a.recordedAt)),
    [app.timeline],
  );

  if (!events.length) return <EmptyState icon="clock" title="No history yet" />;

  return (
    <ol className="tl max-w-[560px]">
      {events.map((e) => (
        <TimelineItem
          key={e.id}
          event={e}
          canUndo={undoable?.id === e.id}
          busy={undo.isPending || review.isPending}
          onUndo={() => undo.mutate(e.id, { onError })}
          onReview={(decision) => review.mutate({ eventId: e.id, decision }, { onError })}
        />
      ))}
    </ol>
  );
}

function TimelineItem({
  event: e,
  canUndo,
  busy,
  onUndo,
  onReview,
}: {
  event: TimelineEvent;
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
  onReview: (d: 'accept' | 'dismiss') => void;
}) {
  const reason = e.reason ? REASON_LABELS[e.reason] : null;
  const note = e.note && e.note !== 'Undo' ? e.note : null;
  const from = e.fromStatus ? STATUS_SHORT[e.fromStatus] : 'New';
  const to = STATUS_SHORT[e.toStatus];
  const meta = (extra?: string) => (
    <div className="ev-m">
      <EventSourceBadge source={e.source} />
      {e.confidence && <Confidence value={e.confidence} />}
      <span className="ev-time">
        {formatEventTime(e.occurredAt)}
        {extra}
      </span>
    </div>
  );

  if (e.disposition === 'pending_review') {
    return (
      <li className="ev">
        <span className="tdot pend">
          <Icon name="zap" />
        </span>
        <div>
          <div className="ev-t">
            <span className="from">{from}</span>
            <span className="arr">→</span>
            <span className={`st-${e.toStatus} font-semibold text-[var(--fg)]`}>{to}</span>
            <span className="tag pend">Pending review</span>
          </div>
          {meta()}
          <div className="ev-box">
            {(note || reason) && <div className="q">{note ?? reason}</div>}
            <div className={`flex flex-wrap items-center gap-2 ${note || reason ? 'mt-2.5' : ''}`}>
              <Button variant="ink" className="md:h-8 md:px-2.5 md:text-[13px]" disabled={busy} onClick={() => onReview('accept')}>
                <Icon name="check" size="sm" />
                Accept
              </Button>
              <Button className="md:h-8 md:px-2.5 md:text-[13px]" disabled={busy} onClick={() => onReview('dismiss')}>
                Dismiss
              </Button>
              <span className="hint">Not applied until you accept.</span>
            </div>
          </div>
        </div>
      </li>
    );
  }

  if (e.revertedAt) {
    return (
      <li className="ev undone">
        <span className="tdot ign">
          <Icon name="undo" />
        </span>
        <div>
          <div className="ev-t">
            <span className="strike">
              {from} → {to}
            </span>
            <span className="tag undo">Undone</span>
          </div>
          {meta(` · undone ${formatDateTime(e.revertedAt)}`)}
        </div>
      </li>
    );
  }

  if (e.disposition === 'ignored' || e.disposition === 'dismissed') {
    return (
      <li className="ev ign">
        <span className="tdot ign">
          <Icon name="slash" />
        </span>
        <div>
          <div className="ev-t">
            <span>{STATUS_LABELS[e.toStatus]}</span>
            <span className="tag ign">{e.disposition === 'ignored' ? 'Ignored' : 'Dismissed'}</span>
          </div>
          {(note || reason) && <div className="ev-note">{note ?? reason}</div>}
          {meta()}
        </div>
      </li>
    );
  }

  return (
    <li className="ev">
      <span className={`tdot st-${e.toStatus}`}>
        <StatusGlyph />
      </span>
      <div>
        <div className="ev-t justify-between">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="from">{from}</span>
            <span className="arr">→</span>
            <span className={`st-${e.toStatus} font-semibold ${e.toStatus === 'offer' ? 'text-[var(--solid)]' : 'text-[var(--fg)]'}`}>{to}</span>
          </span>
          {canUndo && (
            <Button variant="quiet" className="-my-2.5 -mr-2.5 px-2.5 text-[13px] md:my-0 md:mr-0 md:h-8" disabled={busy} onClick={onUndo}>
              <Icon name="undo" size="sm" />
              Undo
            </Button>
          )}
        </div>
        {meta()}
        {(note || (reason && e.reason !== 'no_change')) && <div className="ev-note">{note ?? reason}</div>}
      </div>
    </li>
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
        toast({ message: 'Job description saved', tone: 'info' });
      },
    });
  };

  if (editing || !app.jd) {
    return (
      <form onSubmit={save} className="flex max-w-[var(--read-w)] flex-col gap-3">
        {!app.jd && <p className="m-0 text-[15px] leading-[22px] text-ink-2">No job description saved yet. Paste it here so you still have it if the posting disappears.</p>}
        <Field label="Job description" hint={app.jd ? 'The previous version stays in the history.' : undefined}>
          <textarea className="inp min-h-[320px] text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full job description…" />
        </Field>
        <ErrorNote error={add.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={!text.trim() || add.isPending} busy={add.isPending}>
            Save JD
          </Button>
          {app.jd && (
            <Button variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    );
  }

  return (
    <div>
      <div className="-mt-1.5 mb-1.5 flex items-center gap-1">
        <span className="ev-time flex-1">
          Captured {formatDateTime(app.jd.capturedAt)} · {EVENT_SOURCE_LABELS[app.jd.source]}
          {app.jdHistory.length > 1 && ` · ${app.jdHistory.length} versions`}
        </span>
        <IconButton
          icon="copy"
          label="Copy job description"
          onClick={() => navigator.clipboard.writeText(app.jd!.content).then(() => toast({ message: 'Copied', tone: 'info' }))}
        />
        <IconButton icon="edit" label="Replace job description" onClick={() => setEditing(true)} />
      </div>
      <article className="read whitespace-pre-wrap">{app.jd.content}</article>
    </div>
  );
}

// ---------------------------------------------------------------- Q&A

type DraftAnswer = { question: string; answer: string; libraryItemId: string | null };

function QaTab({ app }: { app: ApplicationDetail }) {
  const save = useReplaceAnswers(app.id);
  const library = useLibrary();
  const toast = useToast();
  const [draft, setDraft] = useState<DraftAnswer[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const current = (): DraftAnswer[] => app.answers.map(({ question, answer, libraryItemId }) => ({ question, answer, libraryItemId }));
  const asked = new Set((draft ?? app.answers).map((a) => a.question.trim().toLowerCase()));
  const available = (library.data ?? []).filter((i) => !asked.has(i.question.toLowerCase())).length;

  if (!draft) {
    return (
      <div className="flex max-w-[560px] flex-col gap-3">
        <Button
          className="w-full"
          onClick={() => {
            setDraft(current());
            setLibraryOpen(true);
          }}
        >
          <Icon name="book" />
          Fill from my standard answers
        </Button>
        {library.data && <div className="hint -mt-1">{available ? `${available} answers in your library aren't used here yet.` : 'Every library answer is already here.'}</div>}
        {app.answers.length === 0 ? (
          <EmptyState icon="chat" title="No screening answers saved">
            Record what you told this company: CTC, notice period, years of Node.js…
          </EmptyState>
        ) : (
          <div className="group">
            {app.answers.map((a) => (
              <div key={a.id} className="qa">
                <div className="q">
                  <span className="flex-1">{a.question}</span>
                  {a.libraryItemId && <span className="tag lock">library</span>}
                </div>
                <div className={`a whitespace-pre-wrap ${a.answer.length > 40 ? 'text-[15px] font-medium' : ''}`}>{a.answer || '—'}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          {app.answers.length > 0 && (
            <Button variant="quiet" className="-ml-2" onClick={() => setDraft(current())}>
              <Icon name="edit" />
              Edit answers
            </Button>
          )}
          <Button variant="quiet" className={app.answers.length ? '' : '-ml-2'} onClick={() => setDraft([...current(), { question: '', answer: '', libraryItemId: null }])}>
            <Icon name="plus" />
            Add question
          </Button>
        </div>
      </div>
    );
  }

  const update = (i: number, patch: Partial<DraftAnswer>) => setDraft((d) => d!.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const valid = draft.filter((a) => a.question.trim());

  return (
    <div className="flex max-w-[560px] flex-col gap-3">
      {draft.map((row, i) => (
        <div key={i} className="card flex flex-col gap-2 p-3">
          <input className="inp text-sm" value={row.question} onChange={(e) => update(i, { question: e.target.value, libraryItemId: null })} placeholder="Question" aria-label={`Question ${i + 1}`} />
          <textarea className="inp min-h-[68px] text-[15px]" value={row.answer} onChange={(e) => update(i, { answer: e.target.value })} placeholder="What you answered" aria-label={`Answer ${i + 1}`} />
          <Button variant="quiet" className="self-start text-sm text-danger" onClick={() => setDraft((d) => d!.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDraft((d) => [...d!, { question: '', answer: '', libraryItemId: null }])}>
          <Icon name="plus" />
          Add question
        </Button>
        <Button onClick={() => setLibraryOpen(true)}>
          <Icon name="book" />
          From my standard answers
        </Button>
      </div>
      <ErrorNote error={save.error} />
      <div className="flex gap-2 pt-3 shadow-[inset_0_1px_0_var(--line)]">
        <Button
          variant="primary"
          busy={save.isPending}
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              valid.map((a) => ({ question: a.question.trim(), answer: a.answer.trim(), libraryItemId: a.libraryItemId })),
              { onSuccess: () => (setDraft(null), toast({ message: 'Answers saved', tone: 'info' })) },
            )
          }
        >
          Save answers
        </Button>
        <Button variant="quiet" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
      <LibraryPicker open={libraryOpen} onClose={() => setLibraryOpen(false)} exclude={asked} onPick={(item) => setDraft((d) => [...(d ?? []), item])} />
    </div>
  );
}

function LibraryPicker({ open, onClose, exclude, onPick }: { open: boolean; onClose: () => void; exclude: Set<string>; onPick: (a: DraftAnswer) => void }) {
  const library = useLibrary();
  const items = (library.data ?? []).filter((i) => !exclude.has(i.question.toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title="Standard answers" headerAction={<Button variant="quiet" onClick={onClose}>Done</Button>}>
      {library.isPending ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="check" title="Nothing left to add" />
      ) : (
        <ul className="m-0 list-none p-0 pb-2">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left shadow-[inset_0_-1px_0_var(--line)] hover:bg-surface-2"
                onClick={() => onPick({ question: item.question, answer: item.answer, libraryItemId: item.origin === 'library' ? item.id : null })}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-[18px] font-medium text-ink-3">{item.question}</span>
                  <span className="block text-[15px] leading-[21px] font-semibold">{item.answer}</span>
                </span>
                {item.origin === 'profile' && <span className="tag lock mt-0.5">profile</span>}
                <Icon name="plus" size="sm" className="mt-1 text-ink-3" />
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
  const saveRecruiter = useSaveRecruiter(app.id);
  const toast = useToast();
  const recruiter = app.contacts.find((c) => c.role === 'recruiter') ?? app.contacts[0];

  const initial = {
    companyName: app.company?.name ?? '',
    roleTitle: app.roleTitle,
    location: app.location ?? '',
    workMode: app.workMode,
    experienceAsked: app.experienceAsked ?? '',
    jobUrl: app.jobUrl ?? '',
    appliedOn: app.appliedOn ?? '',
    followUpOn: app.followUpOn ?? '',
    salaryListed: app.salaryListed ?? '',
    expectedCtc: app.expectedCtcLpa !== null ? String(app.expectedCtcLpa) : (app.expectedCtcRaw ?? ''),
    notes: app.notes ?? '',
  };
  const initialRecruiter = {
    name: recruiter?.name ?? '',
    email: recruiter?.email ?? '',
    reach: recruiter?.linkedinUrl ?? recruiter?.phone ?? '',
  };
  const [form, setForm] = useState(initial);
  const [rec, setRec] = useState(initialRecruiter);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setR = (k: keyof typeof rec) => (e: { target: { value: string } }) => setRec((r) => ({ ...r, [k]: e.target.value }));

  const changed = Object.fromEntries(
    Object.entries(form)
      .filter(([k, v]) => v !== initial[k as keyof typeof initial])
      .map(([k, v]) => [k, v === '' && !['companyName', 'roleTitle'].includes(k) ? null : v]),
  );
  const recruiterChanged = (Object.keys(rec) as Array<keyof typeof rec>).some((k) => rec[k] !== initialRecruiter[k]);
  const changeCount = Object.keys(changed).length + (recruiterChanged ? 1 : 0);
  const busy = update.isPending || saveRecruiter.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (Object.keys(changed).length) await update.mutateAsync(changed);
      // Name is optional server-side: a recruiter known only by email/phone is still saved,
      // and nothing invents a placeholder name.
      const anyRecruiterField = rec.name.trim() || rec.email.trim() || rec.reach.trim();
      if (recruiterChanged && (anyRecruiterField || recruiter)) {
        const reach = rec.reach.trim();
        const isUrl = /linkedin\.com|^https?:/i.test(reach);
        await saveRecruiter.mutateAsync({
          id: recruiter?.id,
          name: rec.name.trim() || null,
          email: rec.email.trim() || null,
          phone: reach && !isUrl ? reach : null,
          linkedinUrl: reach && isUrl ? reach : null,
        });
      }
      toast({ message: 'Saved', tone: 'info' });
    } catch {
      // Errors render below.
    }
  };

  return (
    <form onSubmit={submit} className="flex max-w-[640px] flex-col gap-3.5">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Company">
          <input className="inp" value={form.companyName} onChange={set('companyName')} required />
        </Field>
        <Field label="Role">
          <input className="inp" value={form.roleTitle} onChange={set('roleTitle')} required />
        </Field>
        <Field label="Location">
          <input className="inp" value={form.location} onChange={set('location')} />
        </Field>
        <div className="field">
          <span className="lbl">Work mode</span>
          <Segmented<WorkMode>
            label="Work mode"
            value={form.workMode}
            onChange={(v) => setForm((f) => ({ ...f, workMode: v }))}
            options={WORK_MODES.filter((m) => m !== 'unknown' || form.workMode === 'unknown').map((m) => ({ value: m, label: m === 'unknown' ? '?' : WORK_MODE_LABELS[m] }))}
          />
        </div>
        <Field label="Experience asked" optional>
          <input className="inp" value={form.experienceAsked} onChange={set('experienceAsked')} placeholder="e.g. 2–5 yrs" />
        </Field>
        <Field label="Salary listed" optional>
          <input className="inp" value={form.salaryListed} onChange={set('salaryListed')} placeholder="e.g. 10–15 LPA" />
        </Field>
        <Field label="Applied on">
          <input type="date" className="inp" value={form.appliedOn} onChange={set('appliedOn')} />
        </Field>
        <Field label="Follow up on" optional hint="Shows up in Follow-ups on this day.">
          <input type="date" className="inp" value={form.followUpOn} onChange={set('followUpOn')} />
        </Field>
        <Field label="Expected CTC I gave" optional hint="Encrypted at rest.">
          <div className="ig">
            <input value={form.expectedCtc} onChange={set('expectedCtc')} placeholder="e.g. 12" />
            <span className="suf mr-2">LPA</span>
          </div>
        </Field>
        <Field label="Job posting URL" optional>
          <input type="url" inputMode="url" className="inp" value={form.jobUrl} onChange={set('jobUrl')} />
        </Field>
      </div>

      <div className="sect px-0 pt-2 pb-0">Recruiter</div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Name">
          <input className="inp" value={rec.name} onChange={setR('name')} autoComplete="off" />
        </Field>
        <Field label="Email" optional>
          <input className="inp" type="email" value={rec.email} onChange={setR('email')} autoComplete="off" />
        </Field>
        <Field label="Phone or LinkedIn" optional className="sm:col-span-2">
          <input className="inp" value={rec.reach} onChange={setR('reach')} placeholder="+91… or linkedin.com/in/…" autoComplete="off" />
        </Field>
      </div>

      <Field label="Notes">
        <textarea className="inp min-h-24" value={form.notes} onChange={set('notes')} />
      </Field>
      <p className="hint m-0">
        Source: {APPLICATION_SOURCE_LABELS[app.source]}
        {app.sourceDetail && ` (${app.sourceDetail})`} · added {formatDate(app.createdAt)}
      </p>
      <ErrorNote error={update.error ?? saveRecruiter.error} />

      {/* Save bar: pinned to the bottom while there are unsaved changes. */}
      <div
        className={`sticky bottom-0 z-10 -mx-4 flex items-center gap-3 bg-surface px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] shadow-[0_-1px_0_var(--line)] md:-mx-6 md:px-6 ${
          changeCount ? '' : 'hidden'
        }`}
      >
        <span className="hint flex-1">
          {changeCount} unsaved change{changeCount > 1 ? 's' : ''}
        </span>
        <Button variant="quiet" onClick={() => (setForm(initial), setRec(initialRecruiter))}>
          Discard
        </Button>
        <Button type="submit" variant="primary" disabled={busy} busy={busy}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
