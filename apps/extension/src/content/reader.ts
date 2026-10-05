import { siteForUrl } from '../lib/sites';
import type { PageRead, PageReadMessage } from './types';

/**
 * The page reader, injected only into pages you're viewing: by "Sync this page" (activeTab,
 * one click = one read) or on load for sites you switched on. It reads the rendered DOM as
 * it is — no scrolling, clicking, pagination or extra network requests — and sends nothing
 * to the server by itself.
 */
function read(): PageRead {
  return {
    url: location.href,
    title: document.title.trim(),
    site: siteForUrl(location.href)?.id ?? null,
    readAt: new Date().toISOString(),
  };
}

function autoRead() {
  const message: PageReadMessage = { type: 'page-read', read: read() };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

globalThis.__jst ??= { read, autoRead };
