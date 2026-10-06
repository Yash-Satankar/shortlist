import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { usePublicConfig, type CurrentUser } from '../../auth/useAuth';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Field, IconButton, SectionLabel, Sheet, useToast } from '../../components/ui';
import { formatDate } from '../../lib/format';

/** Settings → Your data: export everything (JSON) or your applications (CSV), or delete the account. */
export function AccountSection() {
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <SectionLabel className="pt-[22px]" action="Yours to take or remove">
        Your data
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        <div className="group">
          <a className="gi" href="/api/account/export?format=json" download>
            <Icon name="file" className="text-ink-2" />
            <div className="min-w-0 flex-1">
              <div className="text-sm leading-5 font-semibold">Export everything</div>
              <div className="ev-time truncate leading-4">JSON · applications, timelines, JDs, answers, emails, prep packs</div>
            </div>
          </a>
          <a className="gi" href="/api/account/export?format=csv" download>
            <Icon name="list" className="text-ink-2" />
            <div className="min-w-0 flex-1">
              <div className="text-sm leading-5 font-semibold">Export applications</div>
              <div className="ev-time truncate leading-4">CSV · opens in Excel or Google Sheets</div>
            </div>
          </a>
          <button type="button" className="gi w-full text-left text-danger" onClick={() => setDeleting(true)}>
            <Icon name="trash" />
            <div className="text-sm leading-5 font-semibold">Delete account</div>
          </button>
        </div>
      </div>
      <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />
    </>
  );
}

function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const del = useMutation({
    mutationFn: () => api<void>('/account/delete', { method: 'POST', json: { password } }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(['auth', 'me'], null);
      window.location.assign('/');
    },
  });
  return (
    <Sheet open={open} onClose={onClose} title="Delete account">
      <form
        className="flex flex-col gap-3.5 px-4 pt-1 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          del.mutate();
        }}
      >
        <p className="m-0 text-[15px] leading-[22px]">
          This permanently deletes your account and everything in it: applications, timelines, job descriptions, answers, emails, prep packs, AI keys and usage. It can’t be undone, so export your data first if you want a copy.
        </p>
        <Field label="Your password">
          <input className="inp" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {del.error && <ErrorNote error={del.error} />}
        <Button type="submit" variant="danger" size="block" disabled={!password || del.isPending} busy={del.isPending}>
          Delete my account
        </Button>
      </form>
    </Sheet>
  );
}

interface Invite {
  id: string;
  email: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

/** Settings → Invites (admins, when sign-up isn't closed): one-time links to create an account. */
export function InvitesSection({ user }: { user: CurrentUser }) {
  const config = usePublicConfig();
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const shown = user.role === 'admin' && config.signupMode !== 'closed';
  const list = useQuery({ queryKey: ['admin-invites'], queryFn: () => api<{ items: Invite[]; ttlDays: number }>('/admin/invites'), enabled: shown });
  const create = useMutation({
    mutationFn: () => api<{ link: string }>('/admin/invites', { method: 'POST', json: { email: email.trim() || null } }),
    onSuccess: (r) => {
      setCreated(r.link);
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['admin-invites'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<void>(`/admin/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-invites'] }),
  });
  if (!shown) return null;
  const open = (list.data?.items ?? []).filter((i) => !i.usedAt);

  return (
    <>
      <SectionLabel className="pt-[22px]" action={`Admin · links last ${list.data?.ttlDays ?? 7} days`}>
        Invites
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Email (optional)" className="flex-1">
            <input className="inp" type="email" placeholder="Only this address can use it" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" disabled={create.isPending} busy={create.isPending}>
            Create link
          </Button>
        </form>
        {created && (
          <div className="ig pr-0">
            <input className="num" readOnly value={created} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
            <IconButton icon="copy" label="Copy invite link" onClick={() => navigator.clipboard.writeText(created).then(() => toast({ message: 'Invite link copied', tone: 'info' }))} />
          </div>
        )}
        {created && <p className="hint m-0 px-0.5">Shown once. Send it yourself; it works for one account.</p>}
        {(create.error || revoke.error) && <ErrorNote error={create.error ?? revoke.error} />}
        {open.length > 0 && (
          <div className="group">
            {open.map((i) => (
              <div key={i.id} className="gi pr-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-5 font-semibold">{i.email ?? 'Anyone with the link'}</div>
                  <div className="ev-time truncate leading-4">expires {formatDate(i.expiresAt)}</div>
                </div>
                <Button variant="quiet" className="px-3 text-sm" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
