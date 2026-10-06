import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  useChangePassword,
  useLibrary,
  useFeature,
  useLibraryWrite,
  useProfile,
  useRevokeSession,
  useSessions,
  useUpdateProfile,
  useUploadResume,
  type DeviceSession,
} from '../api/hooks';
import type { LibraryItem, Profile } from '../api/types';
import type { CurrentUser } from '../auth/useAuth';
import { useLogout } from '../auth/useAuth';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/Layout';
import { Button, ErrorNote, Field, IconButton, SectionLabel, Segmented, Spinner, useToast } from '../components/ui';
import { describeDevice } from '../lib/device';
import { formatDate, relativeDays } from '../lib/format';
import { useThemePref, type ThemePref } from '../lib/theme';
import { ExtensionSection } from './settings/ExtensionSection';
import { AiSection } from './settings/AiSection';
import { EmailSection } from './settings/EmailSection';
import { FeaturesSection } from './settings/FeaturesSection';
import { ErrorsSection } from './settings/ErrorsSection';

export function SettingsPage({ user }: { user: CurrentUser }) {
  const logout = useLogout();
  const profile = useProfile();
  const [theme, setTheme] = useThemePref();
  const extensionOn = useFeature('extension');

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <ScreenHeader title="Settings" />

      <SectionLabel action="Fills your answers">Profile</SectionLabel>
      <div className="px-4">{profile.isPending ? <Spinner /> : profile.data ? <ProfileForm profile={profile.data} /> : <ErrorNote error={profile.error} />}</div>

      <AnswerLibrary />

      <SectionLabel className="pt-[22px]">Resume</SectionLabel>
      <div className="px-4">{profile.data && <ResumeEditor profile={profile.data} />}</div>

      {extensionOn !== false && <ExtensionSection />}

      <AiSection />

      <EmailSection />

      <FeaturesSection />

      {user.role === 'admin' && <ErrorsSection />}

      <SectionLabel className="pt-[22px]">Appearance</SectionLabel>
      <div className="px-4">
        <Segmented<ThemePref>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>

      <SectionLabel className="pt-[22px]">Security</SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        <PasswordRow />
        <div className="hint px-0.5 pt-1">Signed-in devices</div>
        <Devices />
        <p className="hint m-0 px-0.5">
          Follow up after {user.settings.followUpAfterDays} days · post-interview after {user.settings.postInterviewFollowUpDays} days · suggest ghosted after{' '}
          {user.settings.ghostAfterDays} days
        </p>
        <div className="flex items-center justify-between pt-1.5">
          <Button variant="quiet" className="-ml-3" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <Icon name="logout" />
            Sign out
          </Button>
          <span className="ev-time truncate">{user.email}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- profile

function Row({ label, sub, children }: { label: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <label className="gi cursor-text">
      <span className="k">
        {label}
        {sub && <span className="block text-xs leading-4 font-normal text-ink-3">{sub}</span>}
      </span>
      {children}
    </label>
  );
}

const rowInput = 'v min-w-0 flex-1 border-0 bg-transparent p-0 text-right outline-none placeholder:text-ink-4 placeholder:font-normal';

/** CTC row: masked until the eye is tapped; unmounting (leaving the screen) masks it again. */
function MaskedRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="gi pr-1">
      <span className="k">{label}</span>
      {shown ? (
        <input className={`${rowInput} num`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. 12 LPA" aria-label={label} autoComplete="off" autoFocus />
      ) : (
        <span className="v mask" aria-label={value ? `${label} hidden` : `${label} not set`}>
          {value ? '•••••' : '—'}
        </span>
      )}
      <IconButton icon={shown ? 'eyeOff' : 'eye'} label={shown ? `Hide ${label}` : `Reveal ${label}`} aria-pressed={shown} onClick={() => setShown(!shown)} />
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const initial = {
    fullName: profile.fullName ?? '',
    totalExperienceYears: profile.totalExperienceYears?.toString() ?? '',
    noticePeriodDays: profile.noticePeriodDays?.toString() ?? '',
    currentCtc: profile.currentCtc ?? '',
    expectedCtc: profile.expectedCtc ?? '',
    relocation: profile.relocation ?? '',
    currentLocation: profile.currentLocation ?? '',
  };
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = (Object.keys(form) as Array<keyof typeof form>).filter((k) => form[k] !== initial[k]).length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    update.mutate(
      {
        fullName: form.fullName,
        totalExperienceYears: num(form.totalExperienceYears),
        noticePeriodDays: num(form.noticePeriodDays),
        currentLocation: form.currentLocation,
        relocation: form.relocation,
        currentCtc: form.currentCtc,
        expectedCtc: form.expectedCtc,
      },
      { onSuccess: () => toast({ message: 'Profile saved', tone: 'info' }) },
    );
  };

  return (
    <form onSubmit={submit}>
      <div className="group">
        <Row label="Name">
          <input className={rowInput} value={form.fullName} onChange={set('fullName')} autoComplete="name" placeholder="Your name" />
        </Row>
        <Row label="Total experience">
          <input className={`${rowInput} num`} type="number" inputMode="decimal" min={0} step={0.5} value={form.totalExperienceYears} onChange={set('totalExperienceYears')} placeholder="0" />
          <span className="font-mono text-xs text-ink-3">yrs</span>
        </Row>
        <Row label="Notice period" sub="0 = immediate">
          <input className={`${rowInput} num`} type="number" inputMode="numeric" min={0} value={form.noticePeriodDays} onChange={set('noticePeriodDays')} placeholder="0" />
          <span className="font-mono text-xs text-ink-3">days</span>
        </Row>
        <MaskedRow label="Current CTC" value={form.currentCtc} onChange={(v) => setForm((f) => ({ ...f, currentCtc: v }))} />
        <MaskedRow label="Expected CTC" value={form.expectedCtc} onChange={(v) => setForm((f) => ({ ...f, expectedCtc: v }))} />
        <Row label="Relocation">
          <input className={rowInput} value={form.relocation} onChange={set('relocation')} placeholder="e.g. Yes: Bengaluru, Pune" />
        </Row>
        <Row label="Current location">
          <input className={rowInput} value={form.currentLocation} onChange={set('currentLocation')} placeholder="City" />
        </Row>
      </div>
      <div className="hint px-0.5 pt-2">CTC is encrypted at rest and stays masked until you tap the eye. It hides again when you leave this screen.</div>
      <ErrorNote error={update.error} />
      {dirty > 0 && (
        <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 mt-3 flex items-center gap-3 rounded-[14px] bg-surface p-2 pl-3.5 shadow-[var(--shadow-2)] md:bottom-4">
          <span className="hint flex-1">
            {dirty} unsaved change{dirty > 1 ? 's' : ''}
          </span>
          <Button variant="quiet" onClick={() => setForm(initial)}>
            Discard
          </Button>
          <Button type="submit" variant="primary" disabled={update.isPending} busy={update.isPending}>
            Save profile
          </Button>
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------- answer library

function AnswerLibrary() {
  const library = useLibrary();
  const { create, update, remove } = useLibraryWrite();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: '', answer: '' });
  const items = library.data ?? [];
  const locked = items.filter((i) => i.origin === 'profile');
  const own = items.filter((i) => i.origin === 'library');

  const onError = (err: Error) => toast({ message: err.message, tone: 'error' });
  const startEdit = (item: LibraryItem) => {
    setEditing(item.id);
    setDraft({ question: item.question, answer: item.answer });
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const done = { onSuccess: () => (setEditing(null), setDraft({ question: '', answer: '' })), onError };
    if (editing === 'new') create.mutate(draft, done);
    else if (editing) update.mutate({ id: editing, ...draft }, done);
  };

  const form = (
    <form onSubmit={save} className="flex flex-col gap-2 p-3 shadow-[inset_0_-1px_0_var(--line)]">
      <input className="inp text-sm" placeholder="Question" value={draft.question} onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))} required autoFocus />
      <textarea className="inp min-h-[68px] text-[15px]" placeholder="Answer" value={draft.answer} onChange={(e) => setDraft((d) => ({ ...d, answer: e.target.value }))} required />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>
          Save
        </Button>
        <Button variant="quiet" onClick={() => setEditing(null)}>
          Cancel
        </Button>
        {editing && editing !== 'new' && (
          <Button
            variant="quiet"
            className="ml-auto text-danger"
            onClick={() => window.confirm(`Delete "${draft.question}"?`) && remove.mutate(editing, { onError, onSuccess: () => setEditing(null) })}
          >
            <Icon name="trash" />
            Delete
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <>
      <SectionLabel
        className="pt-[22px]"
        count={items.length}
        action={
          <button type="button" className="-my-2 inline-flex min-h-9 items-center gap-1 text-ink" onClick={() => (setEditing('new'), setDraft({ question: '', answer: '' }))}>
            <Icon name="plus" size="xs" />
            Add
          </button>
        }
      >
        Answer library
      </SectionLabel>
      <div className="px-4">
        {library.isPending ? (
          <Spinner />
        ) : (
          <div className="group">
            {editing === 'new' && form}
            {locked.map((item) => (
              <div key={item.id} className="gi items-start bg-surface-2 py-2.5" title="Edit this in Profile above">
                <Icon name="lock" size="sm" className="mt-0.5 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-[18px] font-medium text-ink-3">{item.question}</div>
                  <div className="text-[15px] leading-[21px] font-medium break-words text-ink-2">{item.origin === 'profile' && item.sensitive ? '•••••' : item.answer}</div>
                </div>
                <span className="tag lock bg-surface">from profile</span>
              </div>
            ))}
            {own.map((item) =>
              editing === item.id ? (
                <div key={item.id}>{form}</div>
              ) : (
                <button key={item.id} type="button" className="gi w-full border-0 bg-transparent py-2.5 text-left" onClick={() => startEdit(item)}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-[18px] font-medium text-ink-3">{item.question}</div>
                    <div className="truncate text-[15px] leading-[21px] font-semibold">{item.answer}</div>
                  </div>
                  <Icon name="chevronRight" size="sm" className="text-ink-4" />
                </button>
              ),
            )}
            {!items.length && editing !== 'new' && <div className="gi text-sm text-ink-3">No standard answers yet. Add the ones you type every day.</div>}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- resume

function ResumeEditor({ profile }: { profile: Profile }) {
  const upload = useUploadResume();
  const update = useUpdateProfile();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(profile.resumeText ?? '');
  const [synced, setSynced] = useState(profile.resumeText ?? '');

  // A new upload replaces the editor content.
  if ((profile.resumeText ?? '') !== synced) {
    setSynced(profile.resumeText ?? '');
    setText(profile.resumeText ?? '');
  }

  const onFile = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(file, {
      onSuccess: ({ extracted }) =>
        toast({ message: `Read ${extracted.characters.toLocaleString('en-IN')} characters from your ${extracted.kind.toUpperCase()}. Check the text below.`, tone: 'info' }),
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const has = Boolean(profile.resumeText);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="card flex items-center gap-3 py-2.5 pr-2.5 pl-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-surface-2 text-ink-2">
          <Icon name="file" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-5 font-semibold">{has ? 'Resume text' : 'No resume yet'}</div>
          <div className="ev-time leading-4">
            {has
              ? `${(profile.resumeText ?? '').length.toLocaleString('en-IN')} chars${profile.resumeUpdatedAt ? ` · updated ${formatDate(profile.resumeUpdatedAt)}` : ''}`
              : 'PDF or DOCX'}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button className="px-3 text-sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending} busy={upload.isPending}>
          {!upload.isPending && <Icon name="upload" />}
          {upload.isPending ? 'Reading…' : has ? 'Replace' : 'Upload'}
        </Button>
      </div>
      <ErrorNote error={upload.error ?? update.error} />
      <Field label="Extracted text" hint="Fix extraction mistakes here; this text feeds autofill and prep.">
        <textarea className="inp min-h-[150px] text-sm leading-[21px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Your resume text appears here after upload. You can also paste it." />
      </Field>
      {text !== (profile.resumeText ?? '') && (
        <div className="flex gap-2">
          <Button variant="primary" disabled={update.isPending} busy={update.isPending} onClick={() => update.mutate({ resumeText: text }, { onSuccess: () => toast({ message: 'Resume saved', tone: 'info' }) })}>
            Save resume text
          </Button>
          <Button variant="quiet" onClick={() => setText(profile.resumeText ?? '')}>
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- password

function PasswordRow() {
  const change = useChangePassword();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });

  return (
    <div className="group">
      <button type="button" className="gi w-full border-0 bg-transparent text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="key" className="text-ink-2" />
        <span className="k text-ink">Change password</span>
        <Icon name={open ? 'chevron' : 'chevronRight'} size="sm" className="text-ink-4" />
      </button>
      {open && (
        <form
          className="flex flex-col gap-3 p-3.5 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate(form, {
              onSuccess: () => {
                setOpen(false);
                setForm({ currentPassword: '', newPassword: '' });
                toast({ message: 'Password changed. Other devices were signed out.', tone: 'info' });
              },
            });
          }}
        >
          <Field label="Current password">
            <input type="password" autoComplete="current-password" className="inp" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} required />
          </Field>
          <Field label="New password" hint="At least 10 characters">
            <input type="password" autoComplete="new-password" minLength={10} className="inp" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} required />
          </Field>
          <ErrorNote error={change.error} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={change.isPending} busy={change.isPending}>
              Change password
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- devices

/** "Android · Chrome" from a user-agent string; good enough to recognise your own devices. */

function Devices() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const toast = useToast();
  const onError = (err: Error) => toast({ message: err.message, tone: 'error' });
  const others = (sessions.data ?? []).filter((s) => !s.current).length;

  if (sessions.isPending) return <Spinner />;
  return (
    <>
      <div className="group">
        {sessions.data?.map((s: DeviceSession) => {
          const d = describeDevice(s.userAgent);
          return (
            <div key={s.id} className="gi pr-1">
              <Icon name={d.mobile ? 'phone' : 'monitor'} className="text-ink-2" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm leading-5 font-semibold">
                  <span className="truncate">{d.name}</span>
                  {s.current && <span className="tag flex-none bg-[var(--ok-soft)] text-ok">This device</span>}
                </div>
                <div className="ev-time leading-4" title={`Signed in ${formatDate(s.createdAt)} · expires ${formatDate(s.expiresAt)} unless unused`}>
                  {s.current ? 'active now' : `active ${relativeDays(s.lastSeenAt)}`} · since {formatDate(s.createdAt)}
                </div>
              </div>
              {!s.current && (
                <Button variant="quiet" className="px-3 text-sm" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: s.id }, { onError })}>
                  Sign out
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <ErrorNote error={sessions.error} />
      {others > 0 && (
        <Button
          variant="danger"
          className="w-full"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate('others', { onError, onSuccess: () => toast({ message: 'Other devices signed out', tone: 'info' }) })}
        >
          <Icon name="logout" />
          Sign out all other devices
        </Button>
      )}
    </>
  );
}
