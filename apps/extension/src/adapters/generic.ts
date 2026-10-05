import { clean, elementToText, htmlToText, metaContent } from './dom';
import type { FieldOrigin, JobField, PartialJob } from './types';

type Json = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null => (typeof v === 'string' ? clean(v) : typeof v === 'number' ? String(v) : null);

/** All schema.org JobPosting objects on the page (handles @graph, arrays and multiple scripts). */
export function jobPostingsFromJsonLd(doc: Document): Json[] {
  const found: Json[] = [];
  const visit = (node: unknown) => {
    for (const n of asArray(node as Json | Json[])) {
      if (!n || typeof n !== 'object') continue;
      const type = asArray(n['@type'] as string | string[]);
      if (type.some((t) => typeof t === 'string' && t.toLowerCase() === 'jobposting')) found.push(n);
      if (n['@graph']) visit(n['@graph']);
    }
  };
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      visit(JSON.parse(s.textContent ?? ''));
    } catch {
      // Malformed JSON-LD is common; skip that block.
    }
  }
  return found;
}

function locationFrom(posting: Json): string | null {
  const parts = asArray(posting.jobLocation as Json | Json[])
    .map((loc) => {
      const a = (loc?.address ?? loc) as Json | string;
      if (typeof a === 'string') return clean(a);
      const country = typeof a.addressCountry === 'object' ? str((a.addressCountry as Json).name) : str(a.addressCountry);
      return [str(a.addressLocality), str(a.addressRegion), country].filter(Boolean).join(', ') || null;
    })
    .filter((v): v is string => !!v);
  return parts.length ? [...new Set(parts)].join(' · ').slice(0, 200) : null;
}

function salaryFrom(posting: Json): string | null {
  const base = posting.baseSalary as Json | undefined;
  if (!base || typeof base !== 'object') return null;
  const v = (base.value ?? {}) as Json;
  const cur = str(base.currency) ?? '';
  const min = str(v.minValue);
  const max = str(v.maxValue);
  const single = str(v.value);
  const unit = str(v.unitText)?.toLowerCase();
  const amount = min && max ? `${min}–${max}` : (single ?? min ?? max);
  return amount ? clean(`${cur} ${amount}${unit ? ` per ${unit}` : ''}`) : null;
}

/** schema.org JobPosting → fields (the most reliable generic source: sites publish it for search engines). */
export function fromJsonLd(doc: Document): PartialJob {
  const posting = jobPostingsFromJsonLd(doc)[0];
  if (!posting) return {};
  const org = asArray(posting.hiringOrganization as Json | Json[])[0];
  const remote = asArray(posting.jobLocationType as string | string[]).some((t) => /telecommute/i.test(String(t)));
  return {
    roleTitle: str(posting.title),
    companyName: typeof org === 'string' ? clean(org) : str(org?.name),
    location: locationFrom(posting),
    workMode: remote ? 'remote' : null,
    salaryListed: salaryFrom(posting),
    experienceAsked: str((posting.experienceRequirements as Json | undefined)?.monthsOfExperience)
      ? `${Math.round(Number((posting.experienceRequirements as Json).monthsOfExperience) / 12)}+ years`
      : null,
    jd: htmlToText(typeof posting.description === 'string' ? posting.description : null, doc),
  };
}

/** OpenGraph / meta / <h1>: weak but better than nothing. */
export function fromMeta(doc: Document): PartialJob {
  const h1s = Array.from(doc.querySelectorAll('h1'))
    .map((h) => clean(h.textContent, 300))
    .filter(Boolean);
  return {
    roleTitle: h1s.length === 1 ? h1s[0]! : metaContent(doc, 'og:title'),
    companyName: metaContent(doc, 'og:site_name'),
  };
}

/**
 * The job description by shape: the container with the most paragraph/list text that isn't
 * page chrome. Used only when neither the site adapter nor JSON-LD found one.
 */
export function descriptionByHeuristic(doc: Document): string | null {
  const candidates = Array.from(doc.querySelectorAll('main, article, [role="main"], section, div'));
  let best: { el: Element; score: number } | null = null;
  for (const el of candidates) {
    if (el.closest('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], form, dialog')) continue;
    let score = 0;
    for (const p of Array.from(el.querySelectorAll(':scope > p, :scope > ul > li, :scope > ol > li, :scope > div > p, :scope > div > ul > li'))) {
      score += Math.min((p.textContent ?? '').trim().length, 600);
    }
    if (score > (best?.score ?? 0)) best = { el, score };
  }
  return best && best.score >= 400 ? elementToText(best.el) : null;
}

/** Fill only the empty fields of `base` from `extra`, recording where each came from. */
export function fillGaps(base: PartialJob, origins: Partial<Record<JobField, FieldOrigin>>, extra: PartialJob, origin: FieldOrigin) {
  for (const [k, v] of Object.entries(extra) as [keyof PartialJob, unknown][]) {
    if (v == null || v === '' || base[k] != null) continue;
    (base as Record<string, unknown>)[k] = v;
    if (k !== 'applyOnSite' && k !== 'externalId') origins[k] = origin;
  }
}

