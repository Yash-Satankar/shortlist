import { canonicalJobUrl } from '@jt/shared';
import type { SiteId } from '../lib/sites';
import { clean, elementToText, first, textOf, workModeFrom } from './dom';
import type { PartialJob, SiteAdapter } from './types';

/**
 * Site adapters read the rendered DOM only. Selectors are layered: the current logged-in
 * layout first, then older/logged-out layouts, then stable fallbacks (document.title, data-*
 * hooks, partial class names that survive CSS-module hashing). Anything they miss is filled
 * from JSON-LD and meta tags by the generic reader.
 */

const hasJobId = (url: URL) => Boolean(canonicalJobUrl(url.href)?.externalId);
const textsOf = (root: ParentNode, sel: string) =>
  [...new Set(Array.from(root.querySelectorAll(sel)).map((e) => clean(e.textContent)).filter((t): t is string => !!t))];

// ---------------------------------------------------------------- LinkedIn

const LI_TITLE = [
  '.job-details-jobs-unified-top-card__job-title h1',
  '.job-details-jobs-unified-top-card__job-title',
  '.jobs-unified-top-card__job-title',
  '.top-card-layout__title',
];
const LI_TITLE_TAG = /^(?:\(\d+\+?\)\s*)?(.+?) \| (.+?) \| LinkedIn$/;

const liJobId = (url: URL) => canonicalJobUrl(url.href)?.externalId ?? null;

/**
 * LinkedIn's newer job layout (2025+): class names are generated and change, so everything is
 * keyed by the job id: the "About the job" section id, the title link to /jobs/view/<id>, the
 * "Company, …" label next to it, and filter chips linking back to currentJobId=<id>.
 */
function liNewLayout(doc: Document, id: string) {
  const about = doc.getElementById(`JobDetails_AboutTheJob_${id}`);
  let titleLink: Element | null = null;
  let topCard: Element | null = null;
  for (const a of Array.from(doc.querySelectorAll(`a[href*="/jobs/view/${id}"]`))) {
    if (!clean(a.textContent)) continue;
    for (let up: Element | null = a.parentElement, i = 0; up && i < 8; up = up.parentElement, i++) {
      if (up.querySelector('[aria-label^="Company, " i]')) {
        titleLink = a;
        topCard = up;
        break;
      }
    }
    if (titleLink) break;
  }
  const companyLabel = topCard?.querySelector('[aria-label^="Company, " i]')?.getAttribute('aria-label') ?? null;
  let locationLine: Element | null = null;
  for (let n = titleLink?.closest('p')?.parentElement?.nextElementSibling ?? null; n; n = n.nextElementSibling) {
    if (n.tagName === 'P') {
      locationLine = n;
      break;
    }
  }
  const chips = textsOf(doc, `a[href*="currentJobId=${id}"] span`).join(' ');
  return {
    found: Boolean(about || titleLink),
    roleTitle: clean(titleLink?.textContent, 300),
    companyName: companyLabel ? clean(companyLabel.replace(/^Company,\s*/i, '').replace(/\.$/, ''), 200) : textOf(topCard ?? doc.createElement('div'), ['a[href^="/company/"]'], 200),
    location: clean(locationLine?.querySelector('span')?.textContent, 200),
    workMode: workModeFrom(chips),
    jd: about ? (elementToText(about)?.replace(/^About the job\s*\n+/i, '') ?? null) : null,
  };
}

const linkedin: SiteAdapter = {
  id: 'linkedin',
  isJobPage: (doc, url) => {
    const id = liJobId(url);
    if (!id) return false;
    return Boolean(first(doc, LI_TITLE)) || liNewLayout(doc, id).found || (url.pathname.startsWith('/jobs/view/') && LI_TITLE_TAG.test(doc.title));
  },
  extract(doc, url) {
    const id = liJobId(url);
    const modern = id ? liNewLayout(doc, id) : null;
    // The tab title is "<role> | <company> | LinkedIn" for a selected job (a search's own title
    // has two parts, so it can't match).
    const tag = LI_TITLE_TAG.exec(doc.title.trim());
    const primary = textOf(doc, [
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.job-details-jobs-unified-top-card__tertiary-description-container',
      '.jobs-unified-top-card__primary-description',
    ]);
    const prefs = textsOf(doc, '.job-details-preferences-and-skills, .job-details-fit-level-preferences button, .jobs-unified-top-card__workplace-type').join(' ');
    const jdEl = first(doc, ['#job-details', '.jobs-description__content .jobs-box__html-content', '.jobs-description-content__text', '.show-more-less-html__markup', '.description__text']);
    const apply = textOf(doc, ['.jobs-apply-button', '.jobs-s-apply button', '.top-card-layout__cta-container button']);
    return {
      roleTitle: textOf(doc, LI_TITLE, 300) ?? modern?.roleTitle ?? tag?.[1] ?? null,
      companyName:
        textOf(doc, [
          '.job-details-jobs-unified-top-card__company-name a',
          '.job-details-jobs-unified-top-card__company-name',
          '.jobs-unified-top-card__company-name',
          '.topcard__org-name-link',
        ], 200) ?? modern?.companyName ?? tag?.[2] ?? null,
      location: clean(primary?.split('·')[0]) ?? textOf(doc, ['.topcard__flavor--bullet', '.jobs-unified-top-card__bullet'], 200) ?? modern?.location ?? null,
      workMode: workModeFrom(prefs) ?? modern?.workMode ?? null,
      jd: elementToText(jdEl)?.replace(/^About the job\s*\n+/i, '') ?? modern?.jd ?? null,
      applyOnSite: apply ? /easy apply/i.test(apply) : null,
    };
  },
};

// ---------------------------------------------------------------- Naukri

const naukri: SiteAdapter = {
  id: 'naukri',
  isJobPage: (doc, url) => hasJobId(url) && Boolean(first(doc, ['[class*="jd-header-title"]', 'h1'])),
  extract(doc) {
    const locations = textsOf(doc, '[class*="jhc__location"] a');
    const location = locations.length ? locations.join(', ') : textOf(doc, ['[class*="jhc__location"]', '[class*="loc-wrap"]', '[class*="location"]'], 200);
    const companySite = Boolean(first(doc, ['[class*="company-site-button"]', '#company-site-button']));
    return {
      roleTitle: textOf(doc, ['[class*="jd-header-title"]', 'h1'], 300),
      // The name link, not the wrapper (which also holds the rating and review count).
      companyName: textOf(doc, ['[class*="jd-header-comp-name"] > a', '[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]'], 200),
      location,
      workMode: workModeFrom(`${textOf(doc, ['[class*="jhc__location"]', '[class*="wfh"]']) ?? ''} ${location ?? ''}`),
      experienceAsked: textOf(doc, ['[class*="jhc__exp__"]', '[class*="exp-wrap"]'], 100),
      salaryListed: textOf(doc, ['[class*="jhc__salary__"]', '[class*="salary-wrap"]'], 200),
      jd: elementToText(first(doc, ['[class*="job-desc-container"]', '[class*="dang-inner-html"]', 'section[class*="job-desc"]'])),
      applyOnSite: companySite ? false : first(doc, ['#apply-button', '[class*="apply-button"]']) ? true : null,
    };
  },
};

// ---------------------------------------------------------------- Greenhouse

const greenhouse: SiteAdapter = {
  id: 'greenhouse',
  isJobPage: (doc, url) => hasJobId(url) && Boolean(first(doc, ['.job__title', '.app-title', 'h1'])),
  extract(doc) {
    const fromTag = /\bat (.+?)\s*$/.exec(doc.title.trim())?.[1] ?? null; // "Job Application for X at Acme"
    const logoAlt = clean(first(doc, ['.logo img[alt]', 'header img[alt]'])?.getAttribute('alt'))?.replace(/\s*logo$/i, '') ?? null;
    const location = textOf(doc, ['.job__location', '.location'], 200);
    return {
      roleTitle: textOf(doc, ['.job__title h1', '.job__title', 'h1.app-title', '.app-title', 'h1'], 300),
      companyName: clean(textOf(doc, ['.company-name'], 200)?.replace(/^at\s+/i, '')) ?? fromTag ?? logoAlt,
      location,
      workMode: workModeFrom(location),
      jd: elementToText(first(doc, ['.job__description', '#content'])),
      applyOnSite: true,
    };
  },
};

// ---------------------------------------------------------------- Lever

const lever: SiteAdapter = {
  id: 'lever',
  isJobPage: (doc, url) => hasJobId(url) && Boolean(first(doc, ['.posting-headline h2', '.posting-header h2'])),
  extract(doc) {
    // "Acme - Backend Engineer" (tab title) is the most reliable company source on Lever.
    const tagCompany = clean(doc.title.split(' - ')[0]);
    const desc = first(doc, ['[data-qa="job-description"]']);
    const wrapper = desc?.closest('.section-wrapper') ?? desc?.parentElement ?? null;
    const sections = wrapper
      ? Array.from(wrapper.children).filter((s) => !s.matches('.last-section-apply, [data-qa*="btn-apply"], [data-qa*="apply"]'))
      : [];
    const jd = sections.map((s) => elementToText(s)).filter(Boolean).join('\n\n') || elementToText(desc);
    const location = textOf(doc, ['.posting-categories .location', '.posting-category.location', '.sort-by-location'], 200);
    return {
      roleTitle: textOf(doc, ['.posting-headline h2', '.posting-header h2'], 300),
      companyName: doc.title.includes(' - ') ? tagCompany : clean(first(doc, ['.main-header-logo img[alt]'])?.getAttribute('alt')?.replace(/\s*logo$/i, '')),
      location,
      workMode: workModeFrom(`${textOf(doc, ['.posting-categories .workplaceTypes', '.workplaceTypes']) ?? ''} ${location ?? ''}`),
      jd: jd || null,
      applyOnSite: true,
    };
  },
};

// ---------------------------------------------------------------- Workday

const workday: SiteAdapter = {
  id: 'workday',
  isJobPage: (doc) => Boolean(first(doc, ['[data-automation-id="jobPostingHeader"]'])),
  extract(doc) {
    const location = textsOf(doc, '[data-automation-id="locations"] dd').join(' · ') || null;
    return {
      roleTitle: textOf(doc, ['[data-automation-id="jobPostingHeader"]'], 300),
      location,
      workMode: workModeFrom(`${textsOf(doc, '[data-automation-id="remoteType"] dd').join(' ')} ${location ?? ''}`),
      jd: elementToText(first(doc, ['[data-automation-id="jobPostingDescription"]'])),
      externalId: textsOf(doc, '[data-automation-id="requisitionId"] dd')[0] ?? null,
      applyOnSite: true,
    };
  },
};

/** Workday hosts are <tenant>.wdN.myworkdayjobs.com: the tenant is a weak company hint. */
export function workdayTenant(url: URL): string | null {
  const t = /^([a-z0-9-]+)\.wd\d+\.myworkday(?:jobs|site)\.com$/i.exec(url.hostname)?.[1];
  return t && t !== 'www' ? t.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

export const ADAPTERS: Record<SiteId, SiteAdapter> = { linkedin, naukri, greenhouse, lever, workday };
export type { PartialJob };
