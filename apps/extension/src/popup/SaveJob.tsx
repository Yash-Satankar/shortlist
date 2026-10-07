import { PRODUCT_NAME } from '@jt/shared';
import { WORK_MODE_LABELS, type ApplicationStatus, type FeatureState } from '@jt/shared';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Icon } from '../../../web/src/components/Icon';
import { Button, ErrorNote, Field, Segmented, StatusGlyph, StatusPill } from '../../../web/src/components/ui';
import { formatDate } from '../../../web/src/lib/format';
import type { ExtractedJob, JobField } from '../adapters/types';
import { ApiError } from '../lib/api';
import { hasChrome } from '../lib/config';
import { aiFill, checkDuplicates, draftFromJob, getFeatures, saveJob, type DuplicateMatch, type JobDraft } from '../lib/jobs';
import { readPageText } from '../lib/reads';

const draftKey = (tabId: number) => `draft:${tabId}`;
const FIELD_LABEL: Record<JobField, string> = {
  roleTitle: 'role',
  companyName: 'company',
  location: 'location',
  workMode: 'work mode',
  experienceAsked: 'experience',
  salaryListed: 'salary',
  jd: 'description',
};

/**
 * One-click save: the form is filled from the page (and, on request, by AI for what the rules
 * missed). Nothing is saved until you press Save. Duplicate checks match the web app's Add form.
 */
export function SaveJob({ job, tabId, pageTitle, origin }: { job: ExtractedJob; tabId: number; pageTitle: string; origin: string }) {
  const [draft, setDraft] = useState<JobDraft>(() => draftFromJob(job));
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [ai, setAi] = useState<FeatureState | null>(null);
  const [missing, setMissing] = useState<JobField[]>(job.missing);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const restored = useRef(false);

  // Restore an unsaved draft for this tab (the popup closes whenever you click away).
  useEffect(() => {
    if (!hasChrome()) return;
    void chrome.storage.session.get(draftKey(tabId)).then((r) => {
      const saved = r[draftKey(tabId)] as { jobUrl: string; draft: JobDraft } | undefined;
      if (saved?.jobUrl === job.jobUrl) setDraft(saved.draft);
      restored.current = true;
    });
    void getFeatures()
      .then((f) => setAi(f.ai))
      .catch(() => setAi(null));
  }, [tabId, job.jobUrl]);

  useEffect(() => {
    if (restored.current && hasChrome()) void chrome.storage.session.set({ [draftKey(tabId)]: { jobUrl: job.jobUrl, draft } });
  }, [draft, tabId, job.jobUrl]);

  // Live duplicate check, like the web Add form: URL finds exact matches, company + role likely ones.
  useEffect(() => {
    const t = setTimeout(() => {
      checkDuplicates(draft, job.jobUrl)
        .then(setMatches)
        .catch(() => setMatches([]));
    }, 350);
    return () => clearTimeout(t);
  }, [draft.companyName, draft.roleTitle, job.jobUrl]);

  const exact = matches.find((m) => m.level === 'exact');
  const likely = matches.filter((m) => m.level === 'likely');
  const warnSimilar = !exact && (likely.length > 0 || needsConfirm);
  const canSave = Boolean(draft.companyName.trim() && draft.roleTitle.trim()) && !exact && !saving;

  const set = (k: keyof JobDraft) => (e: ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const open = (path: string) => void chrome.tabs.create({ url: `${origin}${path}` });

  const fillWithAi = async () => {
    setAiBusy(true);
    setAiNote(null);
    setError(null);
    try {
      const { text, truncated } = await readPageText(tabId);
      const { fields } = await aiFill(job, pageTitle, text, missing);
      const filled = missing.filter((f) => fields[f]);
      setDraft((d) => {
        const next = { ...d };
        for (const f of filled) {
          if (f === 'workMode') next.workMode = fields.workMode as JobDraft['workMode'];
          else (next as Record<string, unknown>)[f] = fields[f];
        }
        return next;
      });
      setMissing((m) => m.filter((f) => !filled.includes(f)));
      const still = missing.filter((f) => !filled.includes(f));
      setAiNote(
        `${filled.length ? `Filled ${filled.map((f) => FIELD_LABEL[f]).join(', ')}. Check before saving.` : 'AI couldn’t find them on this page.'}${still.length && filled.length ? ` Not found: ${still.map((f) => FIELD_LABEL[f]).join(', ')}.` : ''}${truncated ? ' (Long page: only its first part was read.)' : ''}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e : new Error('AI fill-in failed'));
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setSaved(await saveJob(job, draft, { confirmDuplicate: needsConfirm || likely.length > 0 }));
      if (hasChrome()) void chrome.storage.session.remove(draftKey(tabId));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'duplicate_likely') {
        setNeedsConfirm(true);
        setMatches(((err.details as { matches?: DuplicateMatch[] })?.matches ?? []).concat(matches.filter((m) => m.level !== 'likely')));
      } else if (err instanceof ApiError && err.code === 'duplicate_exact') {
        setMatches((err.details as { matches?: DuplicateMatch[] })?.matches ?? []);
      } else setError(err instanceof Error ? err : new Error('Couldn’t save'));
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <div className="banner dup" role="status">
          <Icon name="check" />
          <div className="min-w-0 flex-1">
            <b>Saved to {PRODUCT_NAME}</b>
            <div className="mt-0.5 text-ink-2">
              {draft.roleTitle} · {draft.companyName} · {draft.status === 'applied' ? 'Applied' : 'Saved'}
            </div>
          </div>
        </div>
        <Button size="block" onClick={() => open(`/applications/${saved.id}`)}>
          Open in {PRODUCT_NAME}
          <Icon name="external" size="sm" />
        </Button>
      </div>
    );
  }

  const details = [draft.workMode && draft.workMode !== 'unknown' ? WORK_MODE_LABELS[draft.workMode] : null, draft.experienceAsked, draft.salaryListed].filter(Boolean).join(' · ');
  const missingRequired = missing.filter((f) => f === 'roleTitle' || f === 'companyName' || f === 'jd');
  const notFound = (f: JobField) => (missing.includes(f) ? 'Not found on the page' : undefined);

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 px-3.5 py-3">
      {exact && (
        <div className="banner dup" role="status">
          <Icon name="info" />
          <div className="min-w-0 flex-1">
            <b>You already have this job</b>
            <div className="mt-0.5 text-ink-2">Same posting URL{exact.appliedOn ? `. Applied ${formatDate(exact.appliedOn)}.` : '.'}</div>
            <MatchLink match={exact} onOpen={open} />
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
              <MatchLink key={m.id} match={m} onOpen={open} />
            ))}
          </div>
        </div>
      )}

      <Field label="Role" hint={notFound('roleTitle')}>
        <input className="inp" value={draft.roleTitle} onChange={set('roleTitle')} required />
      </Field>
      <Field label="Company" hint={notFound('companyName')}>
        <input className="inp" value={draft.companyName} onChange={set('companyName')} required autoCapitalize="words" />
      </Field>
      <Field label="Location" optional hint={details || undefined}>
        <input className="inp" value={draft.location} onChange={set('location')} />
      </Field>

      {draft.jd ? (
        <div className="card px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Icon name="check" size="sm" className="text-ok" />
            <span className="flex-1 text-[13px] leading-[18px] font-semibold">Job description added</span>
            <span className="ev-time">{draft.jd.length.toLocaleString('en-IN')} chars</span>
          </div>
          <p className="m-0 mt-1.5 line-clamp-2 text-[13px] leading-[19px] text-ink-3">{draft.jd}</p>
        </div>
      ) : (
        <p className="hint m-0">No description found on this page. You can paste it later in {PRODUCT_NAME}.</p>
      )}

      {missingRequired.length > 0 && ai?.enabled && (
        <Button variant="quiet" className="h-11 justify-start rounded-xl font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)]" onClick={() => void fillWithAi()} disabled={aiBusy} busy={aiBusy}>
          {!aiBusy && <Icon name="zap" />}
          {aiBusy ? 'Reading the page…' : `Fill ${missingRequired.map((f) => FIELD_LABEL[f]).join(', ')} with AI`}
        </Button>
      )}
      {missingRequired.length > 0 && ai?.reason === 'needs_ai_key' && <p className="hint m-0">Fill these in yourself, or add an API key in Job Tracker → Settings → AI to let AI read them.</p>}
      {aiNote && <p className="hint m-0">{aiNote}</p>}
      <ErrorNote error={error} />

      <Segmented<JobDraft['status']>
        label="Status"
        value={draft.status}
        onChange={(status) => setDraft((d) => ({ ...d, status }))}
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
        <Button size="block" disabled>
          Already tracked
        </Button>
      ) : (
        <Button type="submit" variant="primary" size="block" disabled={!canSave} busy={saving}>
          {saving ? 'Saving…' : warnSimilar ? 'Save anyway' : draft.status === 'applied' ? 'Save as Applied' : 'Save for later'}
        </Button>
      )}
    </form>
  );
}

/** Same look as the web Add form's match row (a button here: it opens ShortList in a tab). */
function MatchLink({ match, onOpen }: { match: DuplicateMatch; onOpen: (path: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(`/applications/${match.id}`)} className="mt-2.5 -ml-1 flex w-full items-center gap-2.5 rounded-[10px] bg-surface-2 px-2.5 py-2 text-left">
      <span className="min-w-0 flex-1">
        <span className="co block text-[15px]">{match.companyName}</span>
        <span className="role block text-[13px]">
          {match.roleTitle}
          {match.appliedOn && ` · ${formatDate(match.appliedOn)}`}
        </span>
      </span>
      <StatusPill status={match.status as ApplicationStatus} />
      <Icon name="chevronRight" size="sm" className="text-ink-3" />
    </button>
  );
}
