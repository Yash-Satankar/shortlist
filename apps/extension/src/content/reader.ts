import { extractJob } from '../adapters/extract';
import { ADAPTERS } from '../adapters/sites';
import { siteForUrl } from '../lib/sites';
import type { PageRead, PageReadMessage } from './types';

/**
 * The page reader, injected only into pages you're viewing: by "Sync this page" (activeTab,
 * one click = one read) or on load for sites you switched on. It reads the rendered DOM as
 * it is — no scrolling, clicking, pagination or extra network requests — and sends nothing
 * to the server by itself.
 */
function read(manual = false): PageRead {
  const site = siteForUrl(location.href);
  return {
    url: location.href,
    title: document.title.trim(),
    site: site?.id ?? null,
    readAt: new Date().toISOString(),
    job: extractJob(document, location.href, { assumeJob: manual }),
  };
}

/** Single-page sites (Workday, LinkedIn) render the job after load: watch the DOM briefly, never fetch. */
const RENDER_WAIT_MS = 8000;

function whenJobRendered(): Promise<void> {
  const site = siteForUrl(location.href);
  const adapter = site ? ADAPTERS[site.id] : null;
  const ready = () => !adapter || adapter.isJobPage(document, new URL(location.href));
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      if (ready()) done();
    });
    const timer = setTimeout(() => done(), RENDER_WAIT_MS);
    function done() {
      obs.disconnect();
      clearTimeout(timer);
      resolve();
    }
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function autoRead() {
  void whenJobRendered().then(() => {
    const message: PageReadMessage = { type: 'page-read', read: read() };
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  });
}

globalThis.__jst ??= { read, autoRead };
