import { PRODUCT_NAME } from '@jt/shared';
import { elementToText } from '../adapters/dom';
import { extractJob } from '../adapters/extract';
import { readApplicationsList } from '../adapters/lists';
import { TUNING } from '../lib/tuning';
import { ADAPTERS } from '../adapters/sites';
import { detectSubmitted } from '../adapters/submitted';
import { showToast } from './toast';
import { siteForUrl } from '../lib/sites';
import type { PageRead, PageReadMessage, SubmittedMessage, SubmittedReply, ToastActionMessage } from './types';

/**
 * The page reader, injected only into pages you're viewing: by "Sync this page" (activeTab,
 * one click = one read) or on load for sites you switched on. It reads the rendered DOM as
 * it is — no scrolling, clicking, pagination or extra network requests — and sends nothing
 * to the server by itself.
 */
function readOnce(manual: boolean): PageRead {
  const site = siteForUrl(location.href);
  // Your applications list is never treated as a job page.
  const list = readApplicationsList(document, location.href);
  return {
    url: location.href,
    title: document.title.trim(),
    site: site?.id ?? null,
    readAt: new Date().toISOString(),
    job: list ? null : extractJob(document, location.href, { assumeJob: manual }),
    list,
  };
}

/**
 * Read the page. Many career sites render the description after load, so if no description
 * passed the quality gate, keep re-checking as the page changes (throttled, no requests) and
 * stop as soon as one passes, or after jdSettleMaxMs.
 */
async function read(manual = false): Promise<PageRead> {
  const first = readOnce(manual);
  // Wait for late rendering only when a job's description is missing, or a list hasn't rendered yet.
  const waitForJd = first.job?.missing.includes('jd');
  const waitForList = first.list?.unreadable;
  if (!waitForJd && !waitForList) return first;
  return new Promise((resolve) => {
    let latest = first;
    let queued = 0;
    const finish = () => {
      obs.disconnect();
      clearTimeout(queued);
      clearTimeout(cap);
      resolve(latest);
    };
    const recheck = () => {
      queued = 0;
      latest = readOnce(manual);
      if (latest.list ? !latest.list.unreadable : !latest.job?.missing.includes('jd')) finish();
    };
    const obs = new MutationObserver(() => {
      if (!queued) queued = window.setTimeout(recheck, TUNING.jdSettleIdleMs);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const cap = window.setTimeout(() => {
      latest = readOnce(manual);
      finish();
    }, TUNING.jdSettleMaxMs);
  });
}

/** Characters of page text sent for AI fill-in (the server refuses more than LLM_MAX_INPUT_CHARS). */
const PAGE_TEXT_MAX = 36_000;

/**
 * The page's main content as text, for "Fill with AI". Only produced on that click and sent to
 * your own server. Prefers the main/article region, and leaves out consent banners, dialogs,
 * overlays and page chrome (the same filter the readers use).
 */
function pageText(): { text: string; truncated: boolean } {
  const root = document.querySelector('main, [role="main"], article') ?? document.body;
  const text = elementToText(root, Number.MAX_SAFE_INTEGER) ?? '';
  return { text: text.slice(0, PAGE_TEXT_MAX), truncated: text.length > PAGE_TEXT_MAX };
}

/** Single-page sites (Workday, LinkedIn) render the job after load: watch the DOM briefly, never fetch. */
const RENDER_WAIT_MS = 8000;

function whenJobRendered(): Promise<void> {
  const site = siteForUrl(location.href);
  const adapter = site ? ADAPTERS[site.id] : null;
  const ready = () => {
    if (!adapter) return true;
    const list = readApplicationsList(document, location.href);
    return list ? !list.unreadable : adapter.isJobPage(document, new URL(location.href));
  };
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
    void read().then((r) => {
      const message: PageReadMessage = { type: 'page-read', read: r };
      void chrome.runtime.sendMessage(message).catch(() => undefined);
    });
  });
  watchForSubmission();
}

/**
 * Sites you switched on only: watch the rendered page (no requests, throttled) for the
 * platform's own "application submitted" confirmation, e.g. LinkedIn's post-apply dialog,
 * which appears without a page load. Each job is reported at most once per page.
 */
function watchForSubmission() {
  const reported = new Set<string>();
  let queued = false;
  const check = () => {
    queued = false;
    const signal = detectSubmitted(document, location.href);
    if (!signal || reported.has(signal.jobUrl)) return;
    reported.add(signal.jobUrl);
    const job = signal.fresh && signal.onJobPage ? extractJob(document, location.href) : null;
    const message: SubmittedMessage = { type: 'submitted', signal, job: job?.jobUrl === signal.jobUrl ? job : null };
    void (chrome.runtime.sendMessage(message) as Promise<SubmittedReply | undefined>).then((reply) => reply && notify(reply)).catch(() => undefined);
  };
  check();
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(check, 750);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
}

const send = (m: ToastActionMessage) => chrome.runtime.sendMessage(m) as Promise<{ ok: boolean; message?: string }>;

function notify(reply: SubmittedReply) {
  const undo = (created: boolean) => ({
    label: 'Undo',
    run: async () => {
      const r = await send({ type: 'undo-submitted', applicationId: reply.applicationId!, eventId: reply.eventId!, created });
      if (!r?.ok) throw new Error(r?.message ?? `Couldn’t undo. Open ${PRODUCT_NAME} to change it.`);
      return created ? `Removed from ${PRODUCT_NAME}` : 'Undone';
    },
  });
  switch (reply.outcome) {
    case 'applied':
      return showToast({ message: `Marked Applied in ${PRODUCT_NAME}`, action: undo(false) });
    case 'created':
      return showToast({ message: `Saved to ${PRODUCT_NAME} as Applied`, action: undo(true) });
    case 'review':
      return showToast({
        message: `Submission noticed. Confirm it in ${PRODUCT_NAME}’s Follow-ups.`,
        action: { label: 'Open', run: async () => (await send({ type: 'open-app', path: '/follow-ups' }), 'Opened Follow-ups') },
      });
    case 'needs_details':
      return showToast({ message: `Applied here? Open ${PRODUCT_NAME} from the toolbar to save this job.` });
    default:
      return; // already recorded, nothing changed, extension off, or an error: stay quiet
  }
}

globalThis.__jst ??= { read, autoRead, pageText };
