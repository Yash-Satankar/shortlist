import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useChangePassword, useLibrary, useLibraryWrite, useProfile, useUpdateProfile, useUploadResume } from '../api/hooks';
import type { LibraryItem, Profile } from '../api/types';
import type { CurrentUser } from '../auth/useAuth';
import { useLogout } from '../auth/useAuth';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Layout';
import { Button, Card, ErrorNote, Field, inputClass, Spinner, useToast } from '../components/ui';
import { formatDate } from '../lib/format';

export function SettingsPage({ user }: { user: CurrentUser }) {
  const logout = useLogout();
  const profile = useProfile();

  return (
    <>
      <PageHeader title="Settings" />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-4">
        {profile.isPending ? (
          <Spinner />
        ) : profile.data ? (
          <>
            <Section title="Profile" hint="Your standard facts. Screening answers for these come from here.">
              <ProfileForm profile={profile.data} />
            </Section>
            <Section title="Resume" hint="Used for interview prep packs. Upload a PDF or DOCX, then edit the text if needed.">
              <ResumeEditor profile={profile.data} />
            </Section>
          </>
        ) : (
          <ErrorNote error={profile.error} />
        )}

        <Section title="Standard answers" hint="Reused when you record what you told each company">
          <AnswerLibrary />
        </Section>

        <Section title="Account">
          <Card className="space-y-3 p-4">
            <div>
              <p className="text-sm text-slate-500">Signed in as</p>
              <p className="font-medium">{user.email}</p>
            </div>
            <p className="text-xs text-slate-500">
              Follow up after {user.settings.followUpAfterDays} days · post-interview after {user.settings.postInterviewFollowUpDays} days ·
              suggest ghosted after {user.settings.ghostAfterDays} days
            </p>
          </Card>
          <PasswordForm />
          <Button onClick={() => logout.mutate()}>
            <Icon name="logout" className="h-4 w-4" /> Sign out
          </Button>
        </Section>
      </main>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- profile

function ProfileForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const toast = useToast();
  const initial = {
    fullName: profile.fullName ?? '',
    totalExperienceYears: profile.totalExperienceYears?.toString() ?? '',
    noticePeriodDays: profile.noticePeriodDays?.toString() ?? '',
    currentLocation: profile.currentLocation ?? '',
    relocation: profile.relocation ?? '',
    currentCtc: profile.currentCtc ?? '',
    expectedCtc: profile.expectedCtc ?? '',
  };
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = Object.keys(form).some((k) => form[k as keyof typeof form] !== initial[k as keyof typeof initial]);

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
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <input className={inputClass} value={form.fullName} onChange={set('fullName')} autoComplete="name" />
          </Field>
          <Field label="Total experience (years)">
            <input className={inputClass} type="number" inputMode="decimal" min={0} step={0.5} value={form.totalExperienceYears} onChange={set('totalExperienceYears')} />
          </Field>
          <Field label="Notice period (days)" hint="0 = immediate">
            <input className={inputClass} type="number" inputMode="numeric" min={0} value={form.noticePeriodDays} onChange={set('noticePeriodDays')} />
          </Field>
          <Field label="Current location">
            <input className={inputClass} value={form.currentLocation} onChange={set('currentLocation')} />
          </Field>
          <Field label="Relocation">
            <input className={inputClass} value={form.relocation} onChange={set('relocation')} placeholder="e.g. Yes (Hyderabad preferred)" />
          </Field>
          <div />
          <Field label="Current CTC" hint="Encrypted at rest">
            <input className={inputClass} value={form.currentCtc} onChange={set('currentCtc')} placeholder="e.g. 5 LPA" />
          </Field>
          <Field label="Expected CTC" hint="Encrypted at rest">
            <input className={inputClass} value={form.expectedCtc} onChange={set('expectedCtc')} placeholder="e.g. 12 LPA" />
          </Field>
        </div>
        <ErrorNote error={update.error} />
        <Button type="submit" variant="primary" disabled={!dirty || update.isPending}>
          Save profile
        </Button>
      </form>
    </Card>
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
        toast({ message: `Read ${extracted.characters.toLocaleString()} characters from your ${extracted.kind.toUpperCase()}. Review the text below.`, tone: 'info' }),
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
          <Icon name="upload" className="h-4 w-4" /> {upload.isPending ? 'Reading…' : profile.resumeText ? 'Replace from file' : 'Upload PDF or DOCX'}
        </Button>
        {profile.resumeUpdatedAt && <span className="text-xs text-slate-500">Updated {formatDate(profile.resumeUpdatedAt)}</span>}
      </div>
      <ErrorNote error={upload.error ?? update.error} />
      <textarea
        className={`${inputClass} font-mono text-sm`}
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your resume text appears here after upload. You can also paste it."
        aria-label="Resume text"
      />
      <Button
        variant="primary"
        disabled={text === (profile.resumeText ?? '') || update.isPending}
        onClick={() => update.mutate({ resumeText: text }, { onSuccess: () => toast({ message: 'Resume saved', tone: 'info' }) })}
      >
        Save resume text
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------- answer library

function AnswerLibrary() {
  const library = useLibrary();
  const { create, update, remove } = useLibraryWrite();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: '', answer: '' });

  if (library.isPending) return <Spinner />;
  const items = library.data ?? [];

  const startEdit = (item: LibraryItem) => {
    setEditing(item.id);
    setDraft({ question: item.question, answer: item.answer });
  };
  const onError = (err: Error) => toast({ message: err.message, tone: 'error' });
  const save = (e: FormEvent) => {
    e.preventDefault();
    const done = { onSuccess: () => (setEditing(null), setDraft({ question: '', answer: '' })), onError };
    if (editing === 'new') create.mutate(draft, done);
    else if (editing) update.mutate({ id: editing, ...draft }, done);
  };

  const form = (
    <form onSubmit={save} className="space-y-2 p-3">
      <input className={`${inputClass} text-sm`} placeholder="Question" value={draft.question} onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))} required />
      <textarea className={`${inputClass} text-sm`} rows={2} placeholder="Answer" value={draft.answer} onChange={(e) => setDraft((d) => ({ ...d, answer: e.target.value }))} required />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={create.isPending || update.isPending}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );

  return (
    <Card>
      <ul className="divide-y divide-slate-200 dark:divide-slate-800">
        {items.map((item) =>
          editing === item.id ? (
            <li key={item.id}>{form}</li>
          ) : (
            <li key={item.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.question}</p>
                <p className="text-sm break-words text-slate-600 dark:text-slate-400">{item.answer}</p>
              </div>
              {item.origin === 'profile' ? (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800" title="Edit in Profile above">
                  profile
                </span>
              ) : (
                <span className="flex shrink-0 gap-1">
                  <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Edit ${item.question}`} onClick={() => startEdit(item)}>
                    <Icon name="edit" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label={`Delete ${item.question}`}
                    onClick={() => window.confirm(`Delete "${item.question}"?`) && remove.mutate(item.id, { onError })}
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </span>
              )}
            </li>
          ),
        )}
        {editing === 'new' && <li>{form}</li>}
      </ul>
      {editing !== 'new' && (
        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <Button size="sm" onClick={() => (setEditing('new'), setDraft({ question: '', answer: '' }))}>
            <Icon name="plus" className="h-4 w-4" /> Add answer
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- password

function PasswordForm() {
  const change = useChangePassword();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Change password
      </Button>
    );
  }
  return (
    <Card className="p-4">
      <form
        className="space-y-3"
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
          <input type="password" autoComplete="current-password" className={inputClass} value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} required />
        </Field>
        <Field label="New password" hint="At least 10 characters">
          <input type="password" autoComplete="new-password" minLength={10} className={inputClass} value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} required />
        </Field>
        <ErrorNote error={change.error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={change.isPending}>
            Change password
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
