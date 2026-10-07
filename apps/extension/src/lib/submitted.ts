import { PRODUCT_NAME } from '@jt/shared';
import type { SubmittedMessage, SubmittedReply } from '../content/types';
import type { PageRead } from '../content/types';
import { ApiError, apiFetch } from './api';
import { apiOrigin, readState } from './config';
import { lastReadKey } from './reads';

/**
 * Background side of "application submitted" detection. Idempotent twice over: a local
 * "seen" record (no repeat calls on reload/revisit) and the server's evidence key (no second
 * timeline event even across browsers).
 */
const SEEN_KEY = 'submitted-seen';
const SEEN_MAX = 500;

type Seen = Record<string, { at: number; outcome: SubmittedReply['outcome'] }>;

async function seen(): Promise<Seen> {
  return ((await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY] as Seen | undefined) ?? {};
}

async function remember(jobUrl: string, outcome: SubmittedReply['outcome']) {
  const all = await seen();
  all[jobUrl] = { at: Date.now(), outcome };
  const keys = Object.keys(all).sort((a, b) => all[b]!.at - all[a]!.at);
  for (const k of keys.slice(SEEN_MAX)) delete all[k];
  await chrome.storage.local.set({ [SEEN_KEY]: all });
}

interface DetectedResponse {
  applicationId: string | null;
  created: boolean;
  duplicate: boolean;
  event: { id: string; disposition: string } | null;
  needsDetails: boolean;
}

/** Job details to save an untracked job with: from this page, or from the job page read earlier in this tab. */
async function jobDetails(msg: SubmittedMessage, tabId: number | undefined) {
  if (!msg.signal.fresh) return null; // a standing "Applied … ago" never creates a job
  if (msg.job) return msg.job;
  if (tabId === undefined) return null;
  const key = lastReadKey(tabId);
  const earlier = (await chrome.storage.session.get(key))[key] as PageRead | undefined;
  return earlier?.job?.jobUrl === msg.signal.jobUrl ? earlier.job : null;
}

export async function handleSubmitted(msg: SubmittedMessage, tabId: number | undefined): Promise<SubmittedReply> {
  const { signal } = msg;
  if (!(await readState()).token) return { outcome: 'off' };
  if ((await seen())[signal.jobUrl]) return { outcome: 'already' };

  const job = await jobDetails(msg, tabId);
  let res: DetectedResponse;
  try {
    res = await apiFetch<DetectedResponse>('/applications/detected-submission', {
      intent: 'auto',
      method: 'POST',
      json: {
        site: signal.site,
        jobUrl: signal.jobUrl,
        signal: signal.signal,
        verified: signal.verified,
        ...(job?.roleTitle && job.companyName ? { roleTitle: job.roleTitle, companyName: job.companyName } : {}),
        ...(job?.location ? { location: job.location } : {}),
        ...(job?.workMode ? { workMode: job.workMode } : {}),
        ...(job?.jd ? { jd: job.jd } : {}),
      },
    });
  } catch (err) {
    // Extension switched off, offline, server error: say nothing in the page, try again next visit.
    return { outcome: err instanceof ApiError && err.code === 'feature_disabled' ? 'off' : 'error' };
  }

  const outcome: SubmittedReply['outcome'] = res.duplicate
    ? 'already'
    : res.needsDetails
      ? 'needs_details'
      : res.event?.disposition === 'applied'
        ? res.created
          ? 'created'
          : 'applied'
        : res.event?.disposition === 'pending_review'
          ? 'review'
          : 'ignored';
  await remember(signal.jobUrl, outcome);
  return { outcome, applicationId: res.applicationId ?? undefined, eventId: res.event?.id };
}

/** The in-page Undo: a user action. Removes a job this signal created, else undoes the status change. */
export async function undoSubmitted(m: { applicationId: string; eventId: string; created: boolean }): Promise<{ ok: boolean; message?: string }> {
  try {
    if (m.created) await apiFetch(`/applications/${m.applicationId}`, { intent: 'user', method: 'DELETE' });
    else await apiFetch(`/applications/${m.applicationId}/events/${m.eventId}/undo`, { intent: 'user', method: 'POST', json: {} });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof ApiError ? err.message : `Couldn’t reach ${PRODUCT_NAME}` };
  }
}

export async function openApp(path: string) {
  if (!/^\/[a-z0-9/_-]*$/i.test(path)) return;
  await chrome.tabs.create({ url: `${await apiOrigin()}${path}` });
}
