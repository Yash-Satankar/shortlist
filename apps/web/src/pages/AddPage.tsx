import { canonicalJobUrl, type ApplicationStatus } from '@jt/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { checkDuplicates, useCreateApplication } from '../api/hooks';
import type { DuplicateMatch } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, ErrorNote, Field, IconButton, Segmented, StatusGlyph, StatusPill, useToast } from '../components/ui';
import { formatDate } from '../lib/format';
import { guessFromJd, type SharePrefill } from '../lib/share';

export interface AddPageState {
  prefill?: Partial<SharePrefill>;
  via?: 'share';
}

/** "linkedin.com/jobs/view/…" → "LinkedIn": shown as "shared · LinkedIn". */
function sharedFrom(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const known: Record<string, string> = { 'linkedin.com': 'LinkedIn', 'naukri.com': 'Naukri', 'greenhouse.io': 'Greenhouse', 'lever.co': 'Lever', 'myworkdayjobs.com': 'Workday' };
    const hit = Object.keys(known).find((k) => host === k || host.endsWith(`.${k}`));
    return hit ? (known[hit] ?? host) : host;
  } catch {
    return null;
  }
}

/** Keyed by navigation so a second share while the form is open starts fresh. */
export function AddPage() {
  const location = useLocation();
  return <AddForm key={location.key} />;
}

/**
 * Quick-add, also the Android share target. Built for one thumb: everything is prefilled,
 * the status switch and Save sit at the bottom, so a correct share is one tap.
 */
function AddForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateApplication();

  const state = (location.state ?? {}) as AddPageState;
  const prefill = state.prefill ?? {};
  const [form, setForm] = useState({
    jobUrl: prefill.jobUrl ?? '',
    companyName: prefill.companyName ?? '',
    roleTitle: prefill.roleTitle ?? '',
    location: prefill.location ?? '',
    jd: prefill.jd ?? '',
  });
  const [status, setStatus] = useState<ApplicationStatus>('applied');
  const [jdOpen, setJdOpen] = useState(false);
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const shared = state.via === 'share';
  const from = shared && form.jobUrl ? sharedFrom(form.jobUrl) : null;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setNeedsConfirm(false);
  };
  const clear = (k: keyof typeof form) => () => setForm((f) => ({ ...f, [k]: '' }));

  // Live duplicate check (debounced). URL alone finds exact matches; company + role finds likely ones.
  const urlValid = Boolean(canonicalJobUrl(form.jobUrl));
  useEffect(() => {
    const ready = urlValid || (form.companyName.trim() && form.roleTitle.trim());
    if (!ready) return setMatches([]);
    const t = setTimeout(() => {
      checkDuplicates({ companyName: form.companyName, roleTitle: form.roleTitle, jobUrl: urlValid ? form.jobUrl : null })
        .then((r) => setMatches(r.matches))
        .catch(() => setMatches([]));
    }, 400);
    return () => clearTimeout(t);
  }, [form.companyName, form.roleTitle, form.jobUrl, urlValid]);

  const exact = matches.find((m) => m.level === 'exact');
  const likely = matches.filter((m) => m.level === 'likely');
  const hints = matches.filter((m) => m.level === 'hint');

  const onJd = (jd: string) => {
    const guess = guessFromJd(jd);
    setForm((f) => ({
      ...f,
      jd,
      companyName: f.companyName || guess.companyName,
      roleTitle: f.roleTitle || guess.roleTitle,
      location: f.location || guess.location,
    }));
  };

  const pasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setForm((f) => ({ ...f, jobUrl: /https?:\/\/\S+/.exec(text)?.[0] ?? text.trim() }));
    } catch {
      toast({ message: 'Clipboard not available; paste into the field instead', tone: 'error' });
    }
  };

  const close = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        companyName: form.companyName.trim(),
        roleTitle: form.roleTitle.trim(),
        jobUrl: form.jobUrl.trim() || null,
        location: form.location.trim() || null,
        jd: form.jd.trim() || undefined,
        status,
        via: shared ? 'share' : 'manual',
        confirmDuplicate: needsConfirm || likely.length > 0,
      },
      {
        onSuccess: ({ application, hints: created }) => {
          toast({
            message: created.length ? `Saved. You also applied to ${created.map((h) => h.roleTitle).join(', ')} here` : `Saved ${application.company?.name ?? ''}`,
            tone: 'info',
          });
          navigate(`/applications/${application.id}`, { replace: true });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'duplicate_likely') setNeedsConfirm(true);
        },
      },
    );
  };

  const duplicateError = create.error instanceof ApiError && create.error.code.startsWith('duplicate');
  const warnSimilar = !exact && (likely.length > 0 || needsConfirm);
  const canSave = Boolean(form.companyName.trim() && form.roleTitle.trim()) && !exact && !create.isPending;
  const prefilledCompany = Boolean(prefill.companyName) && form.companyName === prefill.companyName;

  return (
    <form onSubmit={submit} className="pt-safe mx-auto flex min-h-dvh max-w-[560px] flex-col md:min-h-0 md:py-6">
      <header className="flex min-h-[52px] items-center gap-1 pr-3 pl-1">
        <IconButton icon="x" label="Close without saving" onClick={close} />
        <h1 className="m-0 flex-1 text-lg leading-6 font-bold tracking-[-0.01em]">Add application</h1>
        {from && <span className="src">shared · {from}</span>}
      </header>

      <div className="flex flex-1 flex-col gap-3.5 px-4 pt-1.5 pb-4">
        {exact && (
          <div className="banner dup" role="status">
            <Icon name="info" />
            <div className="min-w-0 flex-1">
              <b>You already have this job</b>
              <div className="mt-0.5 text-ink-2">Same posting URL{exact.appliedOn ? `. Applied ${formatDate(exact.appliedOn)}.` : '.'}</div>
              <MatchLink match={exact} />
            </div>
          </div>
        )}

        {warnSimilar && (
          <div className="banner warn" role="status">
            <Icon name="alert" />
            <div className="min-w-0 flex-1">
              <b>Similar application exists</b>
              <div className="mt-0.5 text-ink-2">Different URL, so you can still save.</div>
              {likely.map((m) => (
                <MatchLink key={m.id} match={m} />
              ))}
            </div>
          </div>
        )}

        <Field label="Job posting">
          <div className={`ig ${prefill.jobUrl && form.jobUrl === prefill.jobUrl ? 'bg-surface-2 shadow-none' : ''}`}>
            <Icon name="link" size="sm" className="text-ink-3" />
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              className="font-mono text-[13px]"
              value={form.jobUrl}
              onChange={set('jobUrl')}
              placeholder="https://www.linkedin.com/jobs/view/…"
            />
            {!form.jobUrl && (
              <Button variant="quiet" className="h-9 px-2.5 text-sm" onClick={pasteUrl}>
                Paste
              </Button>
            )}
          </div>
        </Field>

        <Field label="Company" hint={prefilledCompany ? 'Read from what was shared. Tap to fix.' : undefined}>
          <div className="ig">
            <input value={form.companyName} onChange={set('companyName')} required autoCapitalize="words" />
            {form.companyName && <IconButton icon="x" label="Clear company" className="h-9 w-9 [&_.i]:h-4 [&_.i]:w-4" onClick={clear('companyName')} />}
          </div>
        </Field>

        <Field label="Role">
          <div className="ig">
            <input value={form.roleTitle} onChange={set('roleTitle')} required />
            {form.roleTitle && <IconButton icon="x" label="Clear role" className="h-9 w-9 [&_.i]:h-4 [&_.i]:w-4" onClick={clear('roleTitle')} />}
          </div>
        </Field>

        <Field label="Location" optional>
          <input className="inp" value={form.location} onChange={set('location')} placeholder="e.g. Bengaluru" />
        </Field>

        {form.jd && !jdOpen ? (
          <div className="card px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Icon name="check" size="sm" className="text-ok" />
              <span className="flex-1 text-[13px] leading-[18px] font-semibold">Job description added</span>
              <span className="ev-time">{form.jd.length.toLocaleString('en-IN')} chars</span>
              <Button variant="quiet" className="-my-2 h-9 px-2 text-[13px]" onClick={() => setJdOpen(true)}>
                Edit
              </Button>
            </div>
            <p className="m-0 mt-1.5 line-clamp-2 text-[13px] leading-[19px] text-ink-3">{form.jd}</p>
          </div>
        ) : jdOpen ? (
          <Field label="Job description" optional hint="Saved as a snapshot, so you keep it if the posting disappears.">
            <textarea className="inp min-h-40 text-sm" value={form.jd} onChange={(e) => onJd(e.target.value)} placeholder="Paste the full JD…" autoFocus />
          </Field>
        ) : (
          <Button variant="quiet" className="h-12 justify-start rounded-xl font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]" onClick={() => setJdOpen(true)}>
            <Icon name="clip" />
            Paste job description
            <span className="hint ml-auto">optional</span>
          </Button>
        )}

        {!exact && hints.length > 0 && <p className="hint m-0">Also at this company: {hints.map((h) => `${h.roleTitle} (${h.status})`).join(', ')}</p>}
        {!duplicateError && <ErrorNote error={create.error} />}
      </div>

      {/* Thumb zone */}
      <div className="sticky bottom-0 flex flex-col gap-2.5 bg-bg px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] md:static">
        <Segmented<ApplicationStatus>
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            {
              value: 'applied',
              label: (
                <>
                  <span className="st-applied text-[var(--fg)]">
                    <StatusGlyph />
                  </span>
                  Applied
                </>
              ),
            },
            {
              value: 'saved',
              label: (
                <>
                  <span className="st-saved text-[var(--fg)]">
                    <StatusGlyph />
                  </span>
                  Saved
                </>
              ),
            },
          ]}
        />
        {exact ? (
          <Button size="block" disabled aria-describedby="dup-why">
            Already tracked
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="block" disabled={!canSave} busy={create.isPending}>
            {create.isPending ? 'Saving…' : warnSimilar ? 'Save anyway' : status === 'applied' ? 'Save as Applied' : 'Save for later'}
          </Button>
        )}
        {exact && (
          <span id="dup-why" className="vh">
            Saving is disabled because this job is already in your list.
          </span>
        )}
      </div>
    </form>
  );
}

function MatchLink({ match }: { match: DuplicateMatch }) {
  return (
    <Link to={`/applications/${match.id}`} className="mt-2.5 -ml-1 flex items-center gap-2.5 rounded-[10px] bg-surface-2 px-2.5 py-2">
      <span className="min-w-0 flex-1">
        <span className="co block text-[15px]">{match.companyName}</span>
        <span className="role block text-[13px]">
          {match.roleTitle}
          {match.appliedOn && ` · ${formatDate(match.appliedOn)}`}
        </span>
      </span>
      <StatusPill status={match.status} />
      <Icon name="chevronRight" size="sm" className="text-ink-3" />
    </Link>
  );
}
