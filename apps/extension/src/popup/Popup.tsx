import { PRODUCT_NAME } from '@jt/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { AppMark, Icon } from '../../../web/src/components/Icon';
import { Button, ErrorNote, Field, SectionLabel, Switch } from '../../../web/src/components/ui';
import type { PageRead } from '../content/types';
import { apiOrigin, EXTENSION_VERSION, hasChrome, readState, type Account, type StoredState } from '../lib/config';
import { connect, disconnect } from '../lib/pairing';
import { switchServer } from '../lib/server';
import { disableSite, enableSite, siteStates, type SiteStates } from '../lib/permissions';
import { activeTab, lastAutoRead, readTab, type ActiveTab } from '../lib/reads';
import { SITES, siteForUrl, type SiteId } from '../lib/sites';
import { SaveJob } from './SaveJob';
import { PortalList } from './PortalList';

/** Popup: pairing, this page (Sync this page), per-site auto-read switches, disconnect. */
export function Popup() {
  const [state, setState] = useState<StoredState | null>(null);
  const [origin, setOrigin] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => void readState().then(setState);
  useEffect(() => {
    reload();
    void apiOrigin().then(setOrigin);
  }, []);

  const connected = Boolean(state?.token);
  const host = origin ? new URL(origin).host : '';

  const openSettings = () => {
    const url = `${origin}/settings`;
    if (hasChrome()) void chrome.tabs.create({ url });
    else window.open(url, '_blank');
  };

  const onDisconnect = async () => {
    const { revokedOnServer } = await disconnect();
    setNotice(revokedOnServer ? null : 'Disconnected here, but the server couldn’t be reached. Revoke it in Settings → Browser extension.');
    reload();
  };

  return (
    <div className="flex flex-col bg-bg">
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 shadow-[inset_0_-1px_0_var(--line)]">
        <AppMark size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] leading-5 font-semibold">{PRODUCT_NAME}</div>
          <div className="ev-time truncate leading-4">{state === null ? '' : connected ? state.account?.email : 'Not connected'}</div>
        </div>
      </header>

      <main className="flex flex-col pb-3">
        {notice && (
          <div className="px-4 pt-3.5">
            <ErrorNote error={new Error(notice)} />
          </div>
        )}

        {state !== null && !connected && <PairCard onOpenSettings={openSettings} onConnected={reload} canOpen={!!origin} origin={origin} onServerChanged={(o) => setOrigin(o)} />}

        <SectionLabel className="pt-[18px]">This page</SectionLabel>
        <div className="px-4">{connected ? <ThisPage account={state?.account ?? null} origin={origin} /> : <div className="group"><div className="gi text-sm text-ink-3"><Icon name="info" size="sm" />Pair first to save jobs from this page.</div></div>}</div>

        <SiteSwitches onError={setNotice} />
      </main>

      <footer className="flex items-center gap-2 px-4 pt-1 pb-3">
        <span className="ev-time truncate">{host}</span>
        <span className="sp" />
        {connected ? (
          <Button variant="quiet" className="-mr-2 px-2.5 text-[13px]" onClick={() => void onDisconnect()}>
            <Icon name="logout" size="sm" />
            Disconnect
          </Button>
        ) : (
          <span className="ev-time">v{EXTENSION_VERSION}</span>
        )}
      </footer>
    </div>
  );
}

function PairCard({
  onOpenSettings,
  onConnected,
  canOpen,
  origin,
  onServerChanged,
}: {
  onOpenSettings: () => void;
  onConnected: () => void;
  canOpen: boolean;
  origin: string;
  onServerChanged: (origin: string) => void;
}) {
  const [code, setCode] = useState('');
  const [editingServer, setEditingServer] = useState(false);
  const [server, setServer] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const saveServer = async () => {
    setChecking(true);
    setServerError(null);
    try {
      onServerChanged(await switchServer(server));
      setEditingServer(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Couldn’t use that server');
    } finally {
      setChecking(false);
    }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect(code);
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Couldn’t connect'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-3.5">
      <form onSubmit={(e) => void submit(e)} className="card flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-surface-2 text-ink-2">
            <Icon name="link" />
          </span>
          <div className="min-w-0">
            <div className="text-sm leading-5 font-semibold">Pair this browser</div>
            <p className="hint m-0 mt-0.5">In {PRODUCT_NAME}, open Settings → Browser extension, create a pairing code and paste it here.</p>
          </div>
        </div>
        <Field label="Pairing code" error={error?.message}>
          <input
            className={`inp num ${error ? 'err' : ''}`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="jt_…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <Button type="submit" variant="primary" size="block" disabled={!code.trim() || busy} busy={busy}>
          Connect
        </Button>
        <Button variant="quiet" className="-mt-1.5" onClick={onOpenSettings} disabled={!canOpen}>
          Open Settings
          <Icon name="external" size="sm" />
        </Button>
        {editingServer ? (
          <div className="flex flex-col gap-2 pt-1 shadow-[inset_0_1px_0_var(--line)]">
            <Field label="Your tracker’s address" error={serverError ?? undefined} hint="Self-hosting? Chrome will ask to allow this one address.">
              <input className={`inp ${serverError ? 'err' : ''}`} value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://tracker.example.com" autoComplete="url" spellCheck={false} />
            </Field>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={!server.trim() || checking} busy={checking} onClick={() => void saveServer()}>
                Use this server
              </Button>
              <Button variant="quiet" onClick={() => (setEditingServer(false), setServerError(null))}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" className="ev-time -mt-1 self-center underline decoration-line-strong underline-offset-[3px]" onClick={() => (setServer(origin), setEditingServer(true))}>
            Server: {origin ? new URL(origin).host : '…'} · change
          </button>
        )}
      </form>
    </div>
  );
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The current tab plus "Sync this page": always available, whether or not its site reads automatically. */
function ThisPage({ account, origin }: { account: Account | null; origin: string }) {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [read, setRead] = useState<{ page: PageRead; how: 'auto' | 'manual' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasChrome()) return;
    void activeTab().then(async (t) => {
      setTab(t);
      const auto = t ? await lastAutoRead(t.id) : null;
      if (auto && auto.url === t?.url) setRead({ page: auto, how: 'auto' });
    });
  }, []);

  const sync = async () => {
    if (!tab) return;
    setBusy(true);
    setError(null);
    try {
      setRead({ page: await readTab(tab.id), how: 'manual' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read this page');
    } finally {
      setBusy(false);
    }
  };

  const site = siteForUrl(tab?.url);
  const host = (() => {
    try {
      return tab?.url ? new URL(tab.url).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  })();

  return (
    <div className="group">
      <div className="gi pr-2">
        <Icon name="file" className="text-ink-2" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-5 font-semibold">{tab?.title || 'No page'}</div>
          <div className="ev-time truncate leading-4">{site ? `${site.name} · ${host}` : host || '—'}</div>
        </div>
        <Button size="sm" onClick={() => void sync()} disabled={!tab} busy={busy}>
          Sync this page
        </Button>
      </div>
      {(read || error) && (
        <div className={`gi text-sm ${error ? 'text-danger' : 'text-ink-2'}`}>
          <Icon name={error ? 'alert' : 'check'} size="sm" />
          <span className="min-w-0 flex-1">
            {error ?? (read!.how === 'auto' ? `Read automatically on load · ${timeOf(read!.page.readAt)}` : `Read just now`)}
          </span>
        </div>
      )}
      {read && !error && (read.page.list ? <PortalList key={read.page.readAt} list={read.page.list} pageUrl={read.page.url} origin={origin} /> : read.page.job ? <SaveJob key={read.page.readAt} job={read.page.job} tabId={tab!.id} pageTitle={read.page.title} origin={origin} /> : <NotAJob />)}
      {__JST_DEV__ && tab && <DevCapture tabId={tab.id} account={account} site={site?.id ?? 'generic'} host={host} />}
    </div>
  );
}

/** Per-site auto-read. Off by default; on = Chrome's permission for that site, off gives it back. */
function SiteSwitches({ onError }: { onError: (msg: string | null) => void }) {
  const [states, setStates] = useState<SiteStates | null>(null);
  const reload = () => {
    if (hasChrome()) void siteStates().then(setStates);
    else setStates(Object.fromEntries(SITES.map((s) => [s.id, false])) as SiteStates);
  };
  useEffect(reload, []);

  const toggle = async (id: SiteId, on: boolean) => {
    onError(null);
    try {
      // The permission request must be the first await (Chrome needs the click's user gesture).
      const ok = on ? await enableSite(id) : await disableSite(id);
      if (!ok && !on) onError('Chrome didn’t remove that permission. Check chrome://extensions → Site access.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Couldn’t change that site');
    }
    reload();
  };

  return (
    <>
      <SectionLabel className="pt-[18px]">Read automatically</SectionLabel>
      <div className="px-4">
        <div className="group">
          {SITES.map((s) => {
            const on = states?.[s.id] ?? false;
            return (
              <div key={s.id} className="gi pr-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-5 font-semibold">{s.name}</div>
                  <div className="ev-time truncate leading-4">{on ? 'On · reads pages as they load' : 'Off · only when you press Sync'}</div>
                </div>
                <Switch checked={on} label={`Read ${s.name} automatically`} onChange={(v) => void toggle(s.id, v)} />
              </div>
            );
          })}
        </div>
        <p className="hint m-0 mt-2 px-1">Only pages you open, read as shown. No scrolling, paging or extra requests. Nothing is saved without your confirmation.</p>
      </div>
    </>
  );
}

function NotAJob() {
  return (
    <div className="gi text-sm text-ink-3">
      <Icon name="info" size="sm" />
      <span className="min-w-0 flex-1">This doesn’t look like a job posting.</span>
    </div>
  );
}

/** DEV BUILDS ONLY (compiled out of production): save this page as a sanitized adapter fixture. */
function DevCapture({ tabId, account, site, host }: { tabId: number; account: Account | null; site: string; host: string }) {
  const [state, setState] = useState<string | null>(null);
  const capture = async () => {
    setState('Capturing…');
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content/capture.js'] });
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (o: { userName: string | null; userEmail: string | null }) => globalThis.__jstCapture?.(o) ?? null,
        args: [{ userName: account?.name ?? null, userEmail: account?.email ?? null }],
      });
      const html = res?.result as string | null;
      if (!html) throw new Error('Capture script not available (is this a dev build?)');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      const name = `${site}-${host.replace(/[^a-z0-9.-]/gi, '')}-${stamp}.html`;
      // Saved by the background worker, so it completes even if this popup closes.
      const saved = (await chrome.runtime.sendMessage({ type: 'save-capture', name, html })) as { ok: boolean; path?: string; error?: string };
      if (!saved?.ok) throw new Error(saved?.error ?? 'Couldn’t save the capture');
      setState(`Saved to Downloads/${saved.path} · review it before sending`);
    } catch (e) {
      setState(e instanceof Error ? e.message : 'Capture failed');
    }
  };
  return (
    <div className="gi pr-2">
      <Icon name="file" size="sm" className="text-ink-3" />
      <span className="hint min-w-0 flex-1">{state ?? 'Dev: save this page as a sanitized fixture'}</span>
      <Button size="sm" variant="quiet" onClick={() => void capture()}>
        Capture
      </Button>
    </div>
  );
}
