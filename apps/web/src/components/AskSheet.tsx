import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAsk, useAskSettings, useFeature, type AskAnswer, type AskCitation } from '../api/hooks';
import { formatDate } from '../lib/format';
import { Icon, type IconName } from './Icon';
import { Button, ErrorNote, Sheet, Spinner, StatusPill } from './ui';

/**
 * "Ask my job search": a sheet that opens from anywhere (Ctrl/Cmd+K, or the Ask button next to
 * the Applications search). Counting questions come back as exact numbers from the database;
 * other questions as a short answer citing the user's own records.
 */
const OPEN_EVENT = 'jt:ask';
export const openAsk = () => window.dispatchEvent(new Event(OPEN_EVENT));

const EXAMPLES = ['How many applications did I send this month?', 'Which companies have interviewed me?', 'What did recruiters say about notice period?'];

const SOURCE_ICON: Record<AskCitation['type'], IconName> = { application: 'list', jd: 'file', answer: 'book', event: 'clock', email: 'mail' };
const SOURCE_TYPE: Record<AskCitation['type'], string> = { application: 'Application', jd: 'Job description', answer: 'Screening answer', event: 'Timeline', email: 'Email' };

/** Mounted once (in the Layout). Hidden entirely when Ask is off for this user. */
export function AskHost() {
  const on = useFeature('chat');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!on) return;
    const show = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_EVENT, show);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      document.removeEventListener('keydown', onKey);
    };
  }, [on]);

  if (!on) return null;
  return <AskSheet open={open} onClose={() => setOpen(false)} />;
}

function AskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const ask = useAsk();
  const settings = useAskSettings(open);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  const submit = (q: string) => {
    const text = q.trim();
    if (!text || ask.isPending) return;
    setQuestion(text);
    ask.mutate(text);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(question);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Ask my job search">
      <form className="flex items-center gap-2 px-4 pt-1" onSubmit={onSubmit}>
        <label className="search flex-1">
          <Icon name="sparkle" />
          <span className="vh">Your question</span>
          <input ref={input} type="search" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your applications" maxLength={500} enterKeyHint="send" />
        </label>
        <Button variant="ink" type="submit" disabled={!question.trim() || ask.isPending}>
          Ask
        </Button>
      </form>

      <div className="px-4 pt-3 pb-4">
        {ask.isPending ? (
          <Spinner label="Looking through your applications…" />
        ) : ask.error ? (
          <ErrorNote error={ask.error} onRetry={() => submit(question)} />
        ) : ask.data ? (
          <Answer data={ask.data} onNavigate={onClose} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="hint">Try</div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="chip h-auto py-1.5 text-left" onClick={() => submit(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="hint m-0 mt-4">
          Searches your applications, job descriptions and answers{settings.data?.includeEmails ? ', and your job emails' : ''}. Counts come from your data; other answers are written by your AI provider, so check the sources.
          <span className="ml-1 hidden md:inline">
            <span className="kbd">{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}</span> <span className="kbd">K</span>
          </span>
        </p>
      </div>
    </Sheet>
  );
}

function Answer({ data, onNavigate }: { data: AskAnswer; onNavigate: () => void }) {
  if (data.kind === 'exact') {
    const { result } = data;
    return (
      <div>
        <p className="m-0 text-[15px] leading-[22px]">{data.answer}</p>
        {result.groups && result.groups.length > 0 && (
          <dl className="group mt-3">
            {result.groups.map((g) => (
              <div key={g.key} className="gi justify-between py-2 text-sm">
                <dt>{g.key}</dt>
                <dd className="num m-0 font-semibold">{g.count}</dd>
              </div>
            ))}
          </dl>
        )}
        {!result.groups && result.rows.length > 0 && (
          <div className="mt-3 -mx-4">
            {result.rows.map((r) => (
              <Link key={r.id} to={`/applications/${r.id}`} className="opt-row" onClick={onNavigate}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.company}</div>
                  <div className="ev-time truncate">
                    {r.role}
                    {r.reachedAt ? ` · ${formatDate(r.reachedAt)}` : r.appliedOn ? ` · applied ${formatDate(r.appliedOn)}` : ''}
                  </div>
                </div>
                <StatusPill status={r.status} />
              </Link>
            ))}
          </div>
        )}
        <p className="ev-time m-0 mt-3 flex items-center gap-1.5">
          <Icon name="check" size="xs" />
          Counted from your data
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="m-0 text-[15px] leading-[22px]">{withRefs(data.answer)}</p>
      {data.citations.length > 0 && (
        <>
          <div className="hint mt-4">Sources</div>
          <div className="mt-1 -mx-4">
            {data.citations.map((c) => {
              const body = (
                <>
                  <span className="ref-chip">{c.ref.slice(1)}</span>
                  <Icon name={SOURCE_ICON[c.type]} className="text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{c.label}</div>
                    <div className="ev-time truncate">
                      {SOURCE_TYPE[c.type]}
                      {c.date ? ` · ${formatDate(c.date)}` : ''}
                    </div>
                  </div>
                </>
              );
              return c.applicationId ? (
                <Link key={c.ref} id={`ask-${c.ref}`} to={`/applications/${c.applicationId}`} className="opt-row" onClick={onNavigate}>
                  {body}
                  <Icon name="chevronRight" size="sm" className="text-ink-3" />
                </Link>
              ) : (
                <div key={c.ref} id={`ask-${c.ref}`} className="opt-row">
                  {body}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** "… notice [S2]." → the citation as a small numbered marker that jumps to its source row. */
function withRefs(text: string): ReactNode[] {
  return text.split(/(\[S\d+\])/g).map((part, i) => {
    const m = /^\[S(\d+)\]$/.exec(part);
    if (!m) return part;
    return (
      <a key={i} href={`#ask-S${m[1]}`} className="ref-chip ml-0.5 align-[1px]" aria-label={`Source ${m[1]}`} onClick={(e) => (e.preventDefault(), document.getElementById(`ask-S${m[1]}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))}>
        {m[1]}
      </a>
    );
  });
}
