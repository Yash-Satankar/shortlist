import type { PageRead } from '../content/types';

export const lastReadKey = (tabId: number) => `read:${tabId}`;

export interface ActiveTab {
  id: number;
  url?: string;
  title?: string;
}

/** The tab the popup was opened on. Opening the popup grants activeTab for it. */
export async function activeTab(): Promise<ActiveTab | null> {
  // Dev builds only: E2E opens the popup as a page and names the tab (it can't click the toolbar icon).
  const devTab = __JST_DEV__ ? Number(new URLSearchParams(location.search).get('tab')) : 0;
  if (devTab) {
    const t = await chrome.tabs.get(devTab);
    return { id: devTab, url: t.url, title: t.title };
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id === undefined ? null : { id: tab.id, url: tab.url, title: tab.title };
}

/** The tab's last automatic (on-load) read, if its site is switched on. */
export async function lastAutoRead(tabId: number): Promise<PageRead | null> {
  const key = lastReadKey(tabId);
  return ((await chrome.storage.session.get(key))[key] as PageRead | undefined) ?? null;
}

export class UnreadablePageError extends Error {
  constructor() {
    super('Chrome doesn’t let extensions read this page. Browser pages, the Web Store and some files are off-limits.');
  }
}

/** "Sync this page": inject the reader into the current tab (activeTab) and read it once. */
export async function readTab(tabId: number): Promise<PageRead> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/reader.js'] });
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__jst?.read(true) ?? null });
    if (!res?.result) throw new UnreadablePageError();
    return res.result as PageRead;
  } catch (e) {
    if (e instanceof UnreadablePageError) throw e;
    throw new UnreadablePageError();
  }
}

/** "Fill with AI": the page's visible main text (one click, sent only to your server). */
export async function readPageText(tabId: number): Promise<{ text: string; truncated: boolean }> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/reader.js'] });
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__jst?.pageText() ?? null });
    if (!res?.result) throw new UnreadablePageError();
    return res.result as { text: string; truncated: boolean };
  } catch {
    throw new UnreadablePageError();
  }
}
