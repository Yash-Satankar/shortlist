import { PORTAL_SITE_LABELS } from '@jt/shared';
import { useState } from 'react';
import { Icon } from '../../../web/src/components/Icon';
import { Button, ErrorNote } from '../../../web/src/components/ui';
import type { ApplicationsList } from '../adapters/lists';
import { hasChrome } from '../lib/config';
import { sendPortalSync, type PortalSyncSummary } from '../lib/portal';

/**
 * Your applications list on a portal: send what was read for review. Proposals only; nothing
 * changes until you accept them in Follow-ups. An unrecognised page reads nothing.
 */
export function PortalList({ list, pageUrl, origin }: { list: ApplicationsList; pageUrl: string; origin: string }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<PortalSyncSummary | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const site = PORTAL_SITE_LABELS[list.site];

  if (list.unreadable) {
    return (
      <div className="gi text-sm text-ink-3">
        <Icon name="alert" size="sm" />
        <span className="min-w-0 flex-1">Couldn’t read this page. Nothing was sent.</span>
      </div>
    );
  }

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      setSummary(await sendPortalSync(list, pageUrl, 'user'));
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Couldn’t send'));
    } finally {
      setBusy(false);
    }
  };
  const openFollowUps = () => (hasChrome() ? void chrome.tabs.create({ url: `${origin}/follow-ups` }) : undefined);

  return (
    <div className="flex flex-col gap-2.5 px-3.5 py-3">
      <div className="flex items-start gap-3">
        <Icon name="list" className="mt-0.5 text-ink-2" />
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-5 font-semibold">
            {list.rows.length} {list.rows.length === 1 ? 'application' : 'applications'} on {site}
          </div>
          <div className="hint mt-0.5">
            {list.dropped ? `${list.dropped} incomplete ${list.dropped === 1 ? 'row was' : 'rows were'} skipped. ` : ''}
            Changes go to Follow-ups for you to review.
          </div>
        </div>
      </div>
      {summary ? (
        <>
          <p className="hint m-0">
            {summary.proposed ? `${summary.proposed} new ${summary.proposed === 1 ? 'proposal' : 'proposals'}` : 'Nothing new'} · {summary.unchanged} unchanged
            {summary.unknownLabels.length ? ` · unknown status: ${summary.unknownLabels.join(', ')}` : ''}
          </p>
          <Button size="block" onClick={openFollowUps}>
            Review in Follow-ups
            <Icon name="external" size="sm" />
          </Button>
        </>
      ) : (
        <Button variant="primary" size="block" onClick={() => void send()} disabled={busy} busy={busy}>
          {busy ? 'Sending…' : 'Send to review'}
        </Button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
