import type { PageReadMessage, SubmittedMessage, ToastActionMessage } from './content/types';
import { syncContentScripts } from './lib/permissions';
import { lastReadKey } from './lib/reads';
import { handleSubmitted, openApp, undoSubmitted } from './lib/submitted';

/**
 * Service worker. Keeps the auto-read content scripts registered for exactly the sites
 * you've granted (re-checked on install, browser start and every permission change) and
 * remembers each tab's last automatic read in session storage (cleared with the tab or the
 * browser), and records "application submitted" confirmations seen on those sites.
 */
const sync = (why: string) =>
  void syncContentScripts()
    .then((r) => {
      if (r.registered.length || r.unregistered.length) console.info(`[job-status-tracker] ${why}: +${r.registered.join(',')} -${r.unregistered.join(',')}`);
    })
    .catch((e: unknown) => console.warn('[job-status-tracker] content script sync failed', e));

chrome.runtime.onInstalled.addListener(({ reason }) => sync(reason));
chrome.runtime.onStartup.addListener(() => sync('startup'));
chrome.permissions.onAdded.addListener(() => sync('granted'));
chrome.permissions.onRemoved.addListener(() => sync('removed'));

// DEV BUILDS ONLY: the popup's fixture-capture tool hands the sanitized page here to save, so the
// download completes even if the popup closes (a download started in the popup can be cut off).
if (__JST_DEV__) {
  chrome.runtime.onMessage.addListener((message: { type?: string; name?: string; html?: string }, sender, sendResponse) => {
    if (message?.type !== 'save-capture' || sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('popup/'))) return;
    const name = String(message.name ?? 'capture.html').replace(/[^a-z0-9._-]/gi, '_');
    const bytes = new TextEncoder().encode(message.html ?? '');
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    chrome.downloads
      .download({ url: `data:text/html;base64,${btoa(bin)}`, filename: `jst-captures/${name}`, saveAs: false, conflictAction: 'uniquify' })
      .then(() => sendResponse({ ok: true, path: `jst-captures/${name}` }))
      .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    return true;
  });
}

chrome.runtime.onMessage.addListener((message: PageReadMessage | SubmittedMessage | ToastActionMessage, sender, sendResponse) => {
  // Only our own content scripts (isolated world of a tab) can send these.
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined) return;
  switch (message?.type) {
    case 'page-read':
      void chrome.storage.session.set({ [lastReadKey(sender.tab.id)]: message.read });
      return;
    case 'submitted':
      void handleSubmitted(message, sender.tab.id).then(sendResponse);
      return true; // async reply
    case 'undo-submitted':
      void undoSubmitted(message).then(sendResponse);
      return true;
    case 'open-app':
      void openApp(message.path).then(() => sendResponse({ ok: true }));
      return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(lastReadKey(tabId)));
