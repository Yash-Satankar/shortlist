import { PRODUCT_NAME } from '@jt/shared';
import { useEffect, useState } from 'react';
import { AppMark, Icon } from '../../../web/src/components/Icon';
import { Button, SectionLabel } from '../../../web/src/components/ui';
import { apiOrigin, EXTENSION_VERSION, hasChrome, readState, type StoredState } from '../lib/config';

/**
 * Popup shell (step 1): header, connection card, "this page" section, footer.
 * Pairing (step 2) and page detection (step 4) fill these in.
 */
export function Popup() {
  const [state, setState] = useState<StoredState | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    void readState().then(setState);
    void apiOrigin().then(setOrigin);
  }, []);

  const connected = Boolean(state?.token);
  const host = origin ? new URL(origin).host : '';

  const openSettings = () => {
    const url = `${origin}/settings`;
    if (hasChrome) void chrome.tabs.create({ url });
    else window.open(url, '_blank');
  };

  return (
    <div className="flex flex-col bg-bg">
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 shadow-[inset_0_-1px_0_var(--line)]">
        <AppMark size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] leading-5 font-semibold">{PRODUCT_NAME}</div>
          <div className="ev-time leading-4">{connected ? state?.account?.email : 'Not connected'}</div>
        </div>
      </header>

      <main className="flex flex-col pb-3">
        {!connected && (
          <div className="px-4 pt-3.5">
            <div className="card flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-surface-2 text-ink-2">
                  <Icon name="link" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm leading-5 font-semibold">Pair this browser</div>
                  <p className="hint m-0 mt-0.5">In {PRODUCT_NAME}, open Settings → Browser extension and create a pairing code.</p>
                </div>
              </div>
              <Button variant="primary" size="block" onClick={openSettings} disabled={!origin}>
                Open Settings
                <Icon name="external" size="sm" />
              </Button>
            </div>
          </div>
        )}

        <SectionLabel className="pt-[18px]">This page</SectionLabel>
        <div className="px-4">
          <div className="group">
            <div className="gi text-sm text-ink-3">
              <Icon name="info" size="sm" />
              {connected ? 'Checking this page…' : 'Pair first to save jobs from this page.'}
            </div>
          </div>
        </div>
      </main>

      <footer className="flex items-center gap-2 px-4 pt-1 pb-3">
        <span className="ev-time truncate">{host}</span>
        <span className="sp" />
        <span className="ev-time">v{EXTENSION_VERSION}</span>
      </footer>
    </div>
  );
}
