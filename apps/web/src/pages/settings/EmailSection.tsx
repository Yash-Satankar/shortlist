import { useCheckEmail, useEmailStatus, type EmailStatus, useFeatures, useInboundAddress, useRegenerateInbound } from '../../api/hooks';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Field, IconButton, SectionLabel, useToast } from '../../components/ui';
import { relativeDays } from '../../lib/format';

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return relativeDays(iso);
};

/** What's wrong with the job mailbox, in one line (null when it's fine). Also shown in Follow-ups. */
export function mailboxProblem(m: NonNullable<EmailStatus['mailbox']>): string | null {
  if (m.reason === 'failing') return `The last ${m.failureCount} checks failed${m.lastError ? `: ${m.lastError}` : ''}`;
  if (m.reason === 'stale') {
    const since = m.lastSuccessAt ?? m.lastRunAt;
    return `${since ? `Last read ${ago(since)}` : 'Not read yet'}. Automatic checks may have stopped`;
  }
  return null;
}

/**
 * Settings → Email updates: job emails (acknowledgements, assessments, interviews, rejections)
 * become status proposals through the normal rules. Hidden when the server doesn't offer it or
 * you switched it off in Features.
 */
export function EmailSection() {
  const features = useFeatures();
  const f = features.data?.features.email_intake;
  const visible = !!f && f.reason !== 'instance_off' && f.reason !== 'user_off';
  const status = useEmailStatus(visible);
  const inbound = useInboundAddress(visible && status.data?.mode === 'inbound');
  const check = useCheckEmail();
  const regenerate = useRegenerateInbound();
  const toast = useToast();
  if (!visible || !status.data) return null;
  const s = status.data;
  const counts = [s.counts.applied && `${s.counts.applied} updated`, s.counts.review && `${s.counts.review} to review`, s.counts.unmatched && `${s.counts.unmatched} to match`].filter(Boolean).join(' · ');

  return (
    <>
      <SectionLabel className="pt-[22px]" action="From your job emails">
        Email updates
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        {s.mode === 'imap' && s.mailbox && (
          <div className="group">
            <div className="gi pr-1">
              <Icon name="inbox" className="text-ink-2" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm leading-5 font-semibold">{s.mailbox.address}</div>
                <div className={`ev-time leading-4 ${s.mailbox.needsAttention ? 'mt-0.5 text-danger' : `truncate ${s.mailbox.lastError ? 'text-danger' : ''}`}`} title={s.mailbox.lastError ?? undefined}>
                  {mailboxProblem(s.mailbox) ?? (s.mailbox.lastError ? `Last check failed: ${s.mailbox.lastError}` : s.mailbox.lastRunAt ? `${s.mailbox.folder} · checked ${ago(s.mailbox.lastRunAt)}` : `${s.mailbox.folder} · not checked yet`)}
                </div>
              </div>
              <Button
                variant="quiet"
                className="px-3 text-sm"
                disabled={check.isPending}
                onClick={() =>
                  check.mutate(undefined, {
                    onSuccess: () => toast({ message: 'Checking your mailbox…', tone: 'info' }),
                    onError: (err) => toast({ message: err.message, tone: 'error' }),
                  })
                }
              >
                Check now
              </Button>
            </div>
            {counts && <div className="gi text-sm text-ink-2">{counts}</div>}
          </div>
        )}
        {s.mode === 'imap' && !s.mailbox && <p className="hint m-0 px-0.5">This server reads one mailbox, which belongs to another account.</p>}

        {s.mode === 'inbound' && (
          <>
            <Field label="Your forwarding address" hint="Forward job emails here (or set an automatic forwarding rule). Only job-related emails are kept.">
              <div className="ig pr-0">
                <input className="num" readOnly value={inbound.data?.address ?? '…'} onFocus={(e) => e.currentTarget.select()} aria-label="Forwarding address" />
                <IconButton
                  icon="copy"
                  label="Copy forwarding address"
                  disabled={!inbound.data}
                  onClick={() => inbound.data && navigator.clipboard.writeText(inbound.data.address).then(() => toast({ message: 'Address copied', tone: 'info' }))}
                />
              </div>
            </Field>
            <ErrorNote error={inbound.error} />
            <Button
              variant="quiet"
              className="-mt-1 self-start px-2 text-sm"
              disabled={regenerate.isPending}
              onClick={() => window.confirm('Create a new address? Emails sent to the old one will be ignored.') && regenerate.mutate(undefined, { onError: (err) => toast({ message: err.message, tone: 'error' }) })}
            >
              New address
            </Button>
            {counts && <p className="hint m-0 px-0.5">{counts}</p>}
          </>
        )}
        <p className="hint m-0 px-0.5">
          Clear rejections and confirmations update the status (undoable). Anything unsure, and every offer, waits in Follow-ups. Emails that aren’t about your applications are never stored.
        </p>
      </div>
    </>
  );
}
