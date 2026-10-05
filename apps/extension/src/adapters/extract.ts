import { canonicalJobUrl, sourceFromHost } from '@jt/shared';
import { siteForUrl } from '../lib/sites';
import { workModeFrom } from './dom';
import { descriptionByHeuristic, fillGaps, fromJsonLd, fromMeta, jobPostingsFromJsonLd } from './generic';
import { ADAPTERS, workdayTenant } from './sites';
import { REQUIRED_FIELDS, type ExtractedJob, type FieldOrigin, type JobField, type PartialJob } from './types';

/**
 * Reads the job on the page, or null when this isn't a job page. Known sites use their
 * adapter, with gaps filled from JSON-LD and meta tags. Unknown sites count as a job page
 * when they publish a JobPosting, or when `assumeJob` is set (you pressed Sync there), in
 * which case whatever can be found is returned and the save form asks for the rest.
 */
export function extractJob(doc: Document, href: string, opts: { assumeJob?: boolean } = {}): ExtractedJob | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const site = siteForUrl(href);
  const adapter = site ? ADAPTERS[site.id] : null;
  const hasPosting = jobPostingsFromJsonLd(doc).length > 0;

  if (adapter ? !adapter.isJobPage(doc, url) : !hasPosting && !opts.assumeJob) return null;

  const job: PartialJob = {};
  const origins: Partial<Record<JobField, FieldOrigin>> = {};
  if (adapter) fillGaps(job, origins, adapter.extract(doc, url), 'site');
  fillGaps(job, origins, fromJsonLd(doc), 'json-ld');
  fillGaps(job, origins, fromMeta(doc), 'meta');
  if (!job.jd) fillGaps(job, origins, { jd: descriptionByHeuristic(doc) }, 'heuristic');
  if (site?.id === 'workday') fillGaps(job, origins, { companyName: workdayTenant(url) }, 'heuristic');
  if (!job.workMode) fillGaps(job, origins, { workMode: workModeFrom(job.location) }, origins.location ?? 'heuristic');

  const canonical = canonicalJobUrl(href);
  // Known job sites get their clean canonical link. For other sites the canonical form is for
  // duplicate matching only (it normalises to https and drops ports), so keep the page's own
  // origin when they differ; the server canonicalises again for matching either way.
  const keepOwn = !canonical?.source && canonical && new URL(canonical.canonical).origin !== url.origin;
  const jobUrl = keepOwn ? `${url.origin}${url.pathname}${url.search}` : (canonical?.canonical ?? href);
  return {
    roleTitle: job.roleTitle ?? null,
    companyName: job.companyName ?? null,
    location: job.location ?? null,
    workMode: job.workMode ?? null,
    experienceAsked: job.experienceAsked ?? null,
    salaryListed: job.salaryListed ?? null,
    jd: job.jd ?? null,
    jobUrl,
    externalId: canonical?.externalId ?? job.externalId ?? null,
    source: canonical?.source ?? sourceFromHost(href),
    applyOnSite: job.applyOnSite ?? null,
    origins,
    adapter: site?.id ?? 'generic',
    missing: REQUIRED_FIELDS.filter((f) => !job[f]),
  };
}
