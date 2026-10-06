import { DRAFT_CHANNEL_LABELS, DRAFT_CHANNELS, type DraftChannel, type DraftPurpose } from '@jt/shared';
import { useEffect, useState } from 'react';
import { useDraft } from '../api/hooks';
import { Icon } from './Icon';
import { Button, buttonClass, ErrorNote, Segmented, Sheet, useToast } from './ui';

/**
 * Follow-up drafts: an email (opens in your mail app or copy), a LinkedIn connection note (hard
 * character limit, counted) or a LinkedIn message. Written by your AI provider, edited by you,
 * never sent from here.
 */
export function DraftSheet({
  item,
  purpose,
  open,
  onClose,
}: {
  item: { id: string; companyName: string; roleTitle: string } | null;
  purpose: DraftPurpose;
  open: boolean;
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<DraftChannel>('email');
  const [note, setNote] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const draft = useDraft();
  const toast = useToast();
  const d = draft.data?.channel === channel ? draft.data : null;

  useEffect(() => {
    if (!open) {
      draft.reset();
      setNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);
  useEffect(() => {
    if (draft.data) {
      setSubject(draft.data.subject ?? '');
      setBody(draft.data.body);
    }
  }, [draft.data]);

  if (!item) return null;
  const write = () => draft.mutate({ applicationId: item.id, channel, purpose, instructions: note.trim() || undefined });
  const max = d?.maxChars ?? null;
  const over = max != null && body.length > max;
  const copy = () =>
    navigator.clipboard.writeText(channel === 'email' ? `Subject: ${subject}\n\n${body}` : body).then(
      () => toast({ message: 'Copied', tone: 'info' }),
      () => toast({ message: 'Couldn’t copy', tone: 'error' }),
    );
  const mailto = `mailto:${encodeURIComponent(d?.to ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const footer = d ? (
    <div className="flex gap-2 pb-3">
      {channel === 'email' && (
        <a className={`${buttonClass('ink', 'md')} flex-1`} href={mailto}>
          <Icon name="mail" />
          Open in mail app
        </a>
      )}
      <Button variant={channel === 'email' ? 'secondary' : 'ink'} className="flex-1" disabled={over} onClick={copy}>
        <Icon name="copy" />
        Copy
      </Button>
    </div>
  ) : (
    <div className="pb-3">
      <Button variant="ink" size="block" busy={draft.isPending} disabled={draft.isPending} onClick={write}>
        <Icon name="sparkle" />
        {draft.isPending ? 'Writing…' : 'Write draft'}
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title={`Follow up · ${item.companyName}`} footer={footer}>
      <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
        <Segmented label="Draft for" value={channel} onChange={setChannel} options={DRAFT_CHANNELS.map((c) => ({ value: c, label: DRAFT_CHANNEL_LABELS[c] }))} />
        {!d ? (
          <>
            <label className="field">
              <span className="lbl">Anything to mention? (optional)</span>
              <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. I’m free for a call next week" />
            </label>
            {draft.error && <ErrorNote error={draft.error} onRetry={write} />}
          </>
        ) : (
          <>
            {channel === 'email' && (
              <label className="field">
                <span className="lbl">Subject</span>
                <input className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </label>
            )}
            <label className="field">
              <span className="lbl flex justify-between">
                Message
                {max != null && (
                  <span className={`num ${over ? 'text-danger' : 'text-ink-3'}`} aria-live="polite">
                    {body.length}/{max}
                  </span>
                )}
              </span>
              <textarea className="inp min-h-[180px] text-[15px] leading-[22px]" value={body} onChange={(e) => setBody(e.target.value)} maxLength={max ?? undefined} />
            </label>
            {channel === 'email' && !d.to && <p className="hint m-0">No recruiter email saved for this application: add the address in your mail app.</p>}
            <Button variant="quiet" className="-ml-2 self-start text-sm" disabled={draft.isPending} onClick={write}>
              <Icon name="refresh" size="sm" />
              {draft.isPending ? 'Writing…' : 'Write another'}
            </Button>
          </>
        )}
        <p className="hint m-0">Nothing is sent from here. {d ? 'Edit it, then copy it or open it in your mail app.' : `Written for ${item.roleTitle} by your AI provider.`}</p>
      </div>
    </Sheet>
  );
}
