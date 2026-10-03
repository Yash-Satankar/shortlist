import type { ApplicationSource } from './enums';

export interface CanonicalJobUrl {
  /** Stable URL used for exact-match deduplication. */
  canonical: string;
  /** Platform job id when one can be extracted (LinkedIn job id, Greenhouse id...). */
  externalId: string | null;
  source: ApplicationSource | null;
}

/** Query params that only track the visitor and never identify the job. */
const TRACKING_PARAMS = new Set([
  'ref',
  'refid',
  'trackingid',
  'trk',
  'trkinfo',
  'lipi',
  'originalsubdomain',
  'source',
  'src',
  'gclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ebp',
  'position',
  'pagenum',
  'from',
  'sid',
  'xid',
  'jobsearchtype',
  'searchtype',
  'lever-source',
  'lever-via',
  'gh_src',
  'utm',
]);

const isTracking = (key: string) => {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || TRACKING_PARAMS.has(k);
};

/**
 * Turns a job link into a stable form so the same posting is recognised no matter
 * which page, app share or tracking link it came from. Returns null for non-URLs.
 */
export function canonicalJobUrl(input: string | null | undefined): CanonicalJobUrl | null {
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^[a-z]{2}\.linkedin\.com$/, 'linkedin.com');
  const path = url.pathname.replace(/\/+$/, '');

  // LinkedIn: /jobs/view/<id>, /jobs/view/<slug>-<id>, or any jobs page with ?currentJobId=<id>
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const id = /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/.exec(path)?.[1] ?? url.searchParams.get('currentJobId');
    if (id && /^\d+$/.test(id)) {
      return { canonical: `https://www.linkedin.com/jobs/view/${id}/`, externalId: id, source: 'linkedin' };
    }
  }

  // Greenhouse hosted boards: boards.greenhouse.io/<co>/jobs/<id> (also job-boards.*, embed with ?token=)
  if (host.endsWith('greenhouse.io')) {
    const m = /^\/([^/]+)\/jobs\/(\d+)/.exec(path);
    const id = m?.[2] ?? url.searchParams.get('token') ?? url.searchParams.get('gh_jid');
    const board = m?.[1] ?? url.searchParams.get('for');
    if (id && board) {
      return { canonical: `https://job-boards.greenhouse.io/${board.toLowerCase()}/jobs/${id}`, externalId: id, source: 'greenhouse' };
    }
  }

  // Lever: jobs.lever.co/<co>/<uuid>[/apply]
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    const m = /^\/([^/]+)\/([0-9a-f-]{36})/i.exec(path);
    if (m) {
      return { canonical: `https://${host}/${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}`, externalId: m[2]!.toLowerCase(), source: 'lever' };
    }
  }

  // Workday: <tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>/job/<location>/<title>_<REQ>[/apply...]
  if (host.endsWith('myworkdayjobs.com') || host.endsWith('myworkdaysite.com')) {
    const m = /^(?:\/[a-z]{2}-[A-Z]{2})?(\/.+?\/job\/.+?_([A-Za-z0-9-]+))(?:\/apply.*)?$/.exec(path);
    if (m) return { canonical: `https://${host}${m[1]}`, externalId: m[2]!, source: 'workday' };
  }

  // Naukri: /job-listings-<slug>-<digits>
  if (host === 'naukri.com' || host.endsWith('.naukri.com')) {
    const id = /job-listings-.*?-(\d{9,})$/.exec(path)?.[1];
    if (id) return { canonical: `https://www.naukri.com${path}`, externalId: id, source: 'naukri' };
  }

  // Company career sites embedding Greenhouse (?gh_jid=) keep that id as the identity.
  const ghJid = url.searchParams.get('gh_jid');

  const params = [...url.searchParams.entries()]
    .filter(([k]) => !isTracking(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return {
    canonical: `https://${host}${path}${query}`,
    externalId: ghJid,
    source: ghJid ? 'greenhouse' : null,
  };
}
