// No imports: this file is also loaded by manifest.ts / vite.config.ts under plain Node.

export type SiteId = 'linkedin' | 'naukri' | 'greenhouse' | 'lever' | 'workday';

export interface SiteDef {
  id: SiteId;
  name: string;
  /** Chrome match patterns. These are the optional host permissions for the site, granted together. */
  origins: string[];
}

/**
 * The job sites the extension can read. One registry for the manifest's optional host
 * permissions, the popup's per-site switches and the auto-read content-script registrations.
 * Reading any of them is OFF until you switch it on (which asks Chrome for that site only).
 */
export const SITES: readonly SiteDef[] = [
  { id: 'linkedin', name: 'LinkedIn', origins: ['https://*.linkedin.com/*'] },
  { id: 'naukri', name: 'Naukri', origins: ['https://*.naukri.com/*'] },
  { id: 'greenhouse', name: 'Greenhouse', origins: ['https://*.greenhouse.io/*'] },
  { id: 'lever', name: 'Lever', origins: ['https://*.lever.co/*'] },
  { id: 'workday', name: 'Workday', origins: ['https://*.myworkdayjobs.com/*', 'https://*.myworkdaysite.com/*'] },
];

export const siteById = (id: SiteId): SiteDef => SITES.find((s) => s.id === id)!;

/** "https://*.linkedin.com/*" → "linkedin.com" */
const domainOf = (pattern: string) => pattern.replace(/^https:\/\/\*\./, '').replace(/\/\*$/, '');

/** Which registered site a page belongs to (https only; the bare domain or any subdomain). */
export function siteForUrl(url: string | undefined): SiteDef | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  return SITES.find((s) => s.origins.some((o) => host === domainOf(o) || host.endsWith(`.${domainOf(o)}`))) ?? null;
}

/** Content-script registration id for a site's auto-read. */
export const autoReadScriptId = (id: SiteId) => `auto-read-${id}`;
