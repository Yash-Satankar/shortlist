import { TUNING } from '../lib/tuning';
import { clean, elementToText, htmlToText, insideNonContent, metaContent } from './dom';
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

/**
 * schema.org JobPosting as microdata (itemscope/itemprop), e.g. SAP SuccessFactors career
 * sites, which often have no JSON-LD and keep the description in spans and <br>s.
 */
export function fromMicrodata(doc: Document): PartialJob {
  const scope = doc.querySelector('[itemscope][itemtype*="schema.org/JobPosting" i]');
  if (!scope) return {};
  const prop = (root: Element, name: string): Element | null => root.querySelector(`[itemprop~="${name}"]`);
  const value = (el: Element | null): string | null => (el ? clean(el.getAttribute('content') ?? el.getAttribute('datetime') ?? el.textContent, 300) : null);

  const org = prop(scope, 'hiringOrganization');
  const companyName = org ? (value(prop(org, 'name')) ?? (org.hasAttribute('itemscope') ? null : value(org))) : null;

  const locations = Array.from(scope.querySelectorAll('[itemprop~="jobLocation"]'))
    .map((loc) => {
      const addr = prop(loc, 'address') ?? loc;
      const parts = ['addressLocality', 'addressRegion', 'addressCountry'].map((n) => value(prop(addr, n))).filter(Boolean);
      return parts.length ? parts.join(', ') : addr.hasAttribute('itemscope') ? null : value(addr);
    })
    .filter((v): v is string => !!v);

  const desc = prop(scope, 'description');
  return {
    roleTitle: value(prop(scope, 'title')),
    companyName,
    location: locations.length ? [...new Set(locations)].join(' · ').slice(0, 200) : null,
    jd: desc ? (desc.getAttribute('content') ? htmlToText(desc.getAttribute('content'), doc) : elementToText(desc)) : null,
  };
}

/** OpenGraph / meta / <h1>: weak but better than nothing. Headings inside banners don't count. */
export function fromMeta(doc: Document): PartialJob {
  const h1s = Array.from(doc.querySelectorAll('h1'))
    .filter((h) => !insideNonContent(h))
    .map((h) => clean(h.textContent, 300))
    .filter(Boolean);
  return {
    roleTitle: h1s.length === 1 ? h1s[0]! : metaContent(doc, 'og:title'),
    companyName: metaContent(doc, 'og:site_name'),
  };
}

// ---------------------------------------------------------------- description quality

/** Words that mark a real job description. */
const JD_SIGNALS = /responsibilit|requirement|qualification|experience|skills?\b|what you(?:'|’)?ll|you will|about the (?:role|job|team|position)|job description|we(?:'|’)?re looking|we are looking|must[- ]have|nice[- ]to[- ]have|\byears\b/gi;
/** Consent, privacy and legal vocabulary (cookie banners, privacy notices, terms). */
const CONSENT_WORDS = /cookies?\b|consent|privacy|gdpr|personal data|third[- ]part(?:y|ies)|opt[- ]out|preferences?\b|tracking|advertis\w*|legitimate interest|accept all|reject all|\bpolicy\b|terms of use/gi;

export interface JdQuality {
  ok: boolean;
  reason: 'ok' | 'too_short' | 'consent_text' | 'no_jd_signals';
  signals: number;
}

/**
 * Is this text really a job description? Long enough (VITE_JD_MIN_CHARS, default 600), not
 * dominated by consent/privacy/legal vocabulary, and (for text found by shape alone) showing
 * at least one job-description signal.
 */
export function jdQuality(text: string | null | undefined, opts: { needSignals?: boolean } = {}): JdQuality {
  const t = text ?? '';
  const signals = (t.match(JD_SIGNALS) ?? []).length;
  if (t.length < TUNING.jdMinChars) return { ok: false, reason: 'too_short', signals };
  const words = Math.max(1, t.split(/\s+/).length);
  const consent = (t.match(CONSENT_WORDS) ?? []).length;
  if (consent / words > 0.04 && consent > signals) return { ok: false, reason: 'consent_text', signals };
  if (opts.needSignals && signals === 0) return { ok: false, reason: 'no_jd_signals', signals };
  return { ok: true, reason: 'ok', signals };
}

const CANDIDATES = 'main, article, [role="main"], section, div, td, span[itemprop], [class*="description" i], [id*="description" i]';
const LINK_TEXT = (el: Element) => Array.from(el.querySelectorAll('a')).reduce((n, a) => n + (a.textContent ?? '').trim().length, 0);

/**
 * The job description by shape, when no structured source or site adapter has one: score
 * containers by readable text (minus links), boost job-description signals, then narrow to the
 * tightest container that still holds most of that text. Consent banners, dialogs, overlays
 * and page chrome are excluded before scoring.
 */
export function descriptionByHeuristic(doc: Document): string | null {
  type Scored = { el: Element; text: string; score: number };
  const scored: Scored[] = [];
  for (const el of Array.from(doc.querySelectorAll(CANDIDATES))) {
    if (insideNonContent(el)) continue;
    const text = elementToText(el) ?? '';
    if (text.length < 200) continue;
    const linkDensity = Math.min(1, LINK_TEXT(el) / text.length);
    const signals = (text.match(JD_SIGNALS) ?? []).length;
    scored.push({ el, text, score: text.length * (1 - linkDensity) * (1 + 0.25 * Math.min(signals, 8)) });
  }
  if (!scored.length) return null;
  let best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  // Narrow: a descendant that keeps ≥ 80% of the text is the posting itself, not the page around it.
  for (;;) {
    const inner = scored.filter((c) => c.el !== best.el && best.el.contains(c.el) && c.text.length >= best.text.length * 0.8);
    if (!inner.length) break;
    best = inner.reduce((a, b) => (b.text.length < a.text.length ? b : a));
  }
  return best.text;
}

/** Fill only the empty fields of `base` from `extra`, recording where each came from. */
export function fillGaps(base: PartialJob, origins: Partial<Record<JobField, FieldOrigin>>, extra: PartialJob, origin: FieldOrigin) {
  for (const [k, v] of Object.entries(extra) as [keyof PartialJob, unknown][]) {
    if (v == null || v === '' || base[k] != null) continue;
    (base as Record<string, unknown>)[k] = v;
    if (k !== 'applyOnSite' && k !== 'externalId') origins[k] = origin;
  }
}

