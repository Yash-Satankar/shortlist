import { canonicalJobUrl, type ApplicationStatus } from '@jt/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { checkDuplicates, useCreateApplication } from '../api/hooks';
import type { DuplicateMatch } from '../api/types';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Layout';
import { Button, Card, ErrorNote, Field, inputClass, StatusBadge, useToast } from '../components/ui';
import { formatDate } from '../lib/format';
import { guessFromJd, type SharePrefill } from '../lib/share';

export interface AddPageState {
  prefill?: Partial<SharePrefill>;
  via?: 'share';
}

const QUICK_STATUSES: Array<{ value: ApplicationStatus; label: string }> = [
  { value: 'applied', label: 'Applied' },
  { value: 'saved', label: 'Saved for later' },
];

/** Keyed by navigation so a second share while the form is open starts fresh. */
export function AddPage() {
  const location = useLocation();
  return <AddForm key={location.key} />;
}

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
  const [showJd, setShowJd] = useState(Boolean(prefill.jd));
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setNeedsConfirm(false);
  };

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

  const onJdPaste = (jd: string) => {
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
        via: state.via === 'share' ? 'share' : 'manual',
        confirmDuplicate: needsConfirm || likely.length > 0,
      },
      {
        onSuccess: ({ application, hints: created }) => {
          toast({
            message: created.length ? `Saved. You also applied to ${created.map((h) => h.roleTitle).join(', ')} here` : 'Saved',
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
  const canSave = form.companyName.trim() && form.roleTitle.trim() && !exact && !create.isPending;

  return (
    <>
      <PageHeader title={state.via === 'share' ? 'Save shared job' : 'Add application'} />
      <main className="mx-auto max-w-3xl px-4 py-4">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Job link">
            <div className="flex gap-2">
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                className={inputClass}
                value={form.jobUrl}
                onChange={set('jobUrl')}
                placeholder="https://www.linkedin.com/jobs/view/…"
              />
              <Button onClick={pasteUrl} aria-label="Paste link from clipboard">
                Paste
              </Button>
            </div>
          </Field>

          {exact && (
            <Card className="border-sky-300 p-3 dark:border-sky-800">
              <p className="text-sm font-medium">You already have this job</p>
              <MatchLink match={exact} />
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company">
              <input className={inputClass} value={form.companyName} onChange={set('companyName')} required autoCapitalize="words" />
            </Field>
            <Field label="Role">
              <input className={inputClass} value={form.roleTitle} onChange={set('roleTitle')} required />
            </Field>
          </div>
          <Field label="Location (optional)">
            <input className={inputClass} value={form.location} onChange={set('location')} />
          </Field>

          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Status</legend>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={status === s.value}
                  onClick={() => setStatus(s.value)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium ${
                    status === s.value
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </fieldset>

          {showJd ? (
            <Field label="Job description" hint="Saved as a snapshot, so you still have it if the posting disappears">
              <textarea
                className={`${inputClass} text-sm`}
                rows={8}
                value={form.jd}
                onChange={(e) => onJdPaste(e.target.value)}
                placeholder="Paste the full JD…"
              />
            </Field>
          ) : (
            <button type="button" onClick={() => setShowJd(true)} className="flex items-center gap-1 text-sm font-medium text-sky-700 dark:text-sky-400">
              <Icon name="plus" className="h-4 w-4" /> Paste the JD
            </button>
          )}

          {!exact && likely.length > 0 && (
            <Card className="border-amber-300 p-3 dark:border-amber-800">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-300">
                <Icon name="alert" className="h-4 w-4" /> Looks like one you already have
              </p>
              {likely.map((m) => (
                <MatchLink key={m.id} match={m} />
              ))}
              <p className="mt-1 text-xs text-slate-500">Saving will still create a separate application.</p>
            </Card>
          )}
          {!exact && hints.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Also at this company: {hints.map((h) => `${h.roleTitle} (${h.status})`).join(', ')}
            </p>
          )}

          {!duplicateError && <ErrorNote error={create.error} />}

          <Button type="submit" variant="primary" className="w-full" disabled={!canSave}>
            {create.isPending ? 'Saving…' : likely.length || needsConfirm ? 'Save anyway' : 'Save'}
          </Button>
        </form>
      </main>
    </>
  );
}

function MatchLink({ match }: { match: DuplicateMatch }) {
  return (
    <Link to={`/applications/${match.id}`} className="mt-1 flex items-center justify-between gap-2 text-sm underline-offset-2 hover:underline">
      <span className="min-w-0 truncate">
        {match.companyName} — {match.roleTitle}
        {match.appliedOn && <span className="text-slate-500"> · {formatDate(match.appliedOn)}</span>}
      </span>
      <StatusBadge status={match.status} />
    </Link>
  );
}
