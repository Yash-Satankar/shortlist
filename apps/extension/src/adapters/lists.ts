import { canonicalJobUrl, type PortalItem, type PortalSite } from '@jt/shared';
import { clean } from './dom';
import { isVerified } from './verification';

/**
 * Applications-list readers (your own "Applied" list on a portal), for portal sync.
 *
 * Defensive by design: a row is read only when every required piece is found in the structure
 * the reader expects (job link, title, company, status). Rows missing anything are dropped and
 * counted, never guessed. If the page doesn't have the expected structure at all, the reader
 * returns `unreadable` and the popup says "Couldn't read this page". Rendered DOM only.
 *
 * Built from the portals' known page structures, NOT yet verified on real captures, so syncs
 * from these readers are review-only proposals (they always are; see the API).
 */
export interface ApplicationsList {
  site: PortalSite;
  /** The page is a portal's applications list. */
  isListPage: true;
  /** Rows read completely. */
  rows: PortalItem[];
  /** Rows on the page that were missing a required piece (not sent). */
  dropped: number;
  /** The expected list structure wasn't found: nothing was read. */
  unreadable: boolean;
  verified: boolean;
}

const text = (root: Element, selectors: string[]) => {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    const t = clean(el?.textContent, 300);
    if (t) return t;
  }
  return null;
};

/** "Applied 3d ago" → { label: "Applied", at: "3d ago" }; "Application viewed · 1w" too. */
export function splitStatus(raw: string): { label: string; at?: string } {
  const t = raw.replace(/\s+/g, ' ').trim();
  const m = /^(.*?)(?:\s*[·•|-]\s*|\s+)((?:on\s+)?(?:\d+\s*(?:s|m|h|d|w|mo|y|sec|secs|seconds?|min|mins|minutes?|hours?|hrs?|days?|weeks?|months?|years?)|an?\s+(?:hour|day|week|month|year))\s*ago|(?:on\s+)?\d{1,2}\s+[A-Z][a-z]{2,8}(?:\s+\d{4})?|today|yesterday)$/i.exec(t);
  return m && m[1] ? { label: m[1].trim(), at: m[2]!.trim() } : { label: t };
}

// ---------------------------------------------------------------- LinkedIn: My Jobs → Applied

const isLinkedInList = (url: URL) =>
  (url.pathname.startsWith('/my-items/saved-jobs') && (url.searchParams.get('cardType') ?? '').toUpperCase() === 'APPLIED') ||
  url.pathname.startsWith('/jobs-tracker');

function readLinkedIn(doc: Document): { rows: PortalItem[]; dropped: number; found: boolean } {
  // Known structure: a results list of entity cards, each with a title link to /jobs/view/<id>,
  // a primary subtitle (company), a secondary subtitle (location) and an insight line (status).
  const cards = Array.from(doc.querySelectorAll('li.reusable-search__result-container, li[class*="entity-result"], div.entity-result, [data-chameleon-result-urn]'));
  const unique = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c)));
  const rows: PortalItem[] = [];
  let dropped = 0;
  for (const card of unique) {
    const link = card.querySelector('.entity-result__title-text a[href*="/jobs/view/"], a.app-aware-link[href*="/jobs/view/"], a[href*="/jobs/view/"]');
    const id = canonicalJobUrl(link ? new URL(link.getAttribute('href') ?? '', 'https://www.linkedin.com').href : null)?.externalId ?? null;
    // LinkedIn repeats the title for screen readers ("Title\nTitle"); take the visible copy.
    const roleTitle = clean(link?.querySelector('span[aria-hidden="true"]')?.textContent ?? link?.textContent, 300);
    const companyName = text(card, ['.entity-result__primary-subtitle', '[class*="primary-subtitle"]']);
    const location = text(card, ['.entity-result__secondary-subtitle', '[class*="secondary-subtitle"]']);
    const status = text(card, ['.entity-result__insights', '.reusable-search-simple-insight__text', '[class*="simple-insight"]', '[class*="entity-result__insights"]']);
    if (!id || !roleTitle || !companyName || !status) {
      dropped++;
      continue;
    }
    const { label, at } = splitStatus(status);
    rows.push({ externalId: id, jobUrl: `https://www.linkedin.com/jobs/view/${id}/`, roleTitle, companyName, ...(location ? { location } : {}), statusLabel: label, ...(at ? { statusAt: at } : {}) });
  }
  return { rows, dropped, found: unique.length > 0 };
}

// ---------------------------------------------------------------- Naukri: My Applies

const isNaukriList = (url: URL) => /^\/(?:mnjuser\/)?myapply\b/i.test(url.pathname) || /^\/mnjuser\/applies\b/i.test(url.pathname);

function readNaukri(doc: Document): { rows: PortalItem[]; dropped: number; found: boolean } {
  // Known structure (CSS-module class names, so matched by stable fragments): one card per
  // application with a job-listing link, a company name and an application-status label.
  const cards = Array.from(doc.querySelectorAll('[class*="applyCard"], [class*="apply-card"], [class*="appliedJobCard"], article[class*="apply"]'));
  const unique = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c)));
  const rows: PortalItem[] = [];
  let dropped = 0;
  for (const card of unique) {
    const link = card.querySelector('a[href*="job-listings-"]');
    const href = link ? new URL(link.getAttribute('href') ?? '', 'https://www.naukri.com').href : null;
    const canonical = canonicalJobUrl(href);
    const roleTitle = clean(card.querySelector('[class*="title"] a[href*="job-listings-"], [class*="jobTitle"], [class*="title"]')?.textContent ?? link?.textContent, 300);
    const companyName = text(card, ['[class*="compName"]', '[class*="companyName"]', '[class*="comp-name"]', '[class*="company"]']);
    const location = text(card, ['[class*="location"]', '[class*="loc"]']);
    const status = text(card, ['[class*="statusLabel"]', '[class*="applyStatus"]', '[class*="status"]']);
    if (!canonical?.externalId || !roleTitle || !companyName || !status) {
      dropped++;
      continue;
    }
    const { label, at } = splitStatus(status);
    rows.push({ externalId: canonical.externalId, jobUrl: canonical.canonical, roleTitle, companyName, ...(location ? { location } : {}), statusLabel: label, ...(at ? { statusAt: at } : {}) });
  }
  return { rows, dropped, found: unique.length > 0 };
}

/** The applications list on this page, or null when this isn't a list page at all. */
export function readApplicationsList(doc: Document, href: string): ApplicationsList | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const site: PortalSite | null = /(^|\.)linkedin\.com$/.test(host) && isLinkedInList(url) ? 'linkedin' : /(^|\.)naukri\.com$/.test(host) && isNaukriList(url) ? 'naukri' : null;
  if (!site) return null;
  const read = site === 'linkedin' ? readLinkedIn(doc) : readNaukri(doc);
  return {
    site,
    isListPage: true,
    rows: read.rows,
    dropped: read.dropped,
    // Structure not found, or found but no row complete: nothing is sent.
    unreadable: !read.found || read.rows.length === 0,
    verified: isVerified(site, 'applicationsList'),
  };
}
