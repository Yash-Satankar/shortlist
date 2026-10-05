import type { PageReadMessage } from './content/types';
import { syncContentScripts } from './lib/permissions';
import { lastReadKey } from './lib/reads';

/**
 * Service worker. Keeps the auto-read content scripts registered for exactly the sites
 * you've granted (re-checked on install, browser start and every permission change) and
 * remembers each tab's last automatic read in session storage (cleared with the tab or the
 * browser; never sent anywhere from here).
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

chrome.runtime.onMessage.addListener((message: PageReadMessage, sender) => {
  // Only our own content scripts (isolated world of a tab) can send this.
  if (message?.type !== 'page-read' || sender.id !== chrome.runtime.id || sender.tab?.id === undefined) return;
  void chrome.storage.session.set({ [lastReadKey(sender.tab.id)]: message.read });
});

chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(lastReadKey(tabId)));
