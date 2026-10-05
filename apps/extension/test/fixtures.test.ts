import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractJob } from '../src/adapters/extract';
import { detectSubmitted } from '../src/adapters/submitted';
import { CAPABILITIES, VERIFIED, type Capability } from '../src/adapters/verification';

const DIR = path.resolve(import.meta.dirname, 'fixtures');

interface Header {
  url: string;
  synthetic?: boolean;
  assumeJob?: boolean;
  /** What the fixture proves (default jobPage). */
  capability?: Capability;
}

const fixtures = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(path.join(DIR, d.name))
      .filter((f) => f.endsWith('.html'))
      .map((f) => {
        const html = readFileSync(path.join(DIR, d.name, f), 'utf8');
        const header = JSON.parse(/^<!-- fixture: (\{.*?\}) -->/.exec(html)?.[1] ?? 'null') as Header | null;
        const expected = JSON.parse(readFileSync(path.join(DIR, d.name, f.replace(/\.html$/, '.expected.json')), 'utf8')) as Record<string, unknown>;
        return { name: `${d.name}/${f}`, html, header, expected };
      }),
  );

/** Parsed like a page Chrome rendered, but inert: jsdom runs no scripts and loads nothing. */
const load = (html: string, url: string) => new JSDOM(html, { url }).window.document;

describe('adapter fixtures', () => {
  it('there is at least one fixture per site and the generic reader', () => {
    expect(new Set(fixtures.map((f) => f.name.split('/')[0]))).toEqual(new Set(['linkedin', 'naukri', 'greenhouse', 'lever', 'workday', 'generic']));
  });

  const byCapability = (c: Capability) => fixtures.filter((f) => (f.header?.capability ?? 'jobPage') === c);

  it.each(byCapability('jobPage'))('job page: $name', ({ html, header, expected }) => {
    expect(header?.url, 'fixture header with a url').toBeTruthy();
    const doc = load(html, header!.url);
    // A job page by itself must never count as a submission.
    expect(detectSubmitted(doc, header!.url), 'no submission on a plain job page').toBeNull();
    const job = extractJob(doc, header!.url, { assumeJob: header!.assumeJob });

    if (expected.isJob === false) {
      expect(job).toBeNull();
      return;
    }
    expect(job).not.toBeNull();
    const { jdIncludes = [], jdExcludes = [], ...fields } = expected as { jdIncludes?: string[]; jdExcludes?: string[] };
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'origins') expect(job!.origins).toMatchObject(value as object);
      else expect(job![key as keyof typeof job], key).toEqual(value);
    }
    for (const s of jdIncludes) expect(job!.jd, `jd includes "${s}"`).toContain(s);
    for (const s of jdExcludes) expect(job!.jd ?? '', `jd excludes "${s}"`).not.toContain(s);
  });

  it.each(byCapability('submitted'))('submitted: $name', ({ html, header, expected }) => {
    const hit = detectSubmitted(load(html, header!.url), header!.url);
    if (expected.submitted === null) expect(hit).toBeNull();
    else expect(hit).toMatchObject(expected.submitted as object);
  });

  it('negative submitted fixtures exist for the flows that look closest to a submission', () => {
    const negatives = byCapability('submitted').filter((f) => f.expected.submitted === null).map((f) => f.name);
    expect(negatives).toEqual(expect.arrayContaining(['linkedin/synthetic-easy-apply-midflow.html', 'greenhouse/synthetic-form-errors.html']));
  });
});

describe('verification status', () => {
  // A capability may be marked verified only with a REAL (non-synthetic) fixture proving it.
  const cases = Object.entries(VERIFIED).flatMap(([site, caps]) => CAPABILITIES.filter((c) => caps[c]).map((c) => ({ site, capability: c })));
  it.each(cases.length ? cases : [{ site: '(none)', capability: 'jobPage' as Capability }])('$site $capability has a real capture', ({ site, capability }) => {
    if (site === '(none)') return; // nothing verified yet
    const real = fixtures.filter((f) => f.name.startsWith(`${site}/`) && !f.header?.synthetic && (f.header?.capability ?? 'jobPage') === capability);
    expect(real.length, `${site} ${capability} is marked verified but has no real captured fixture`).toBeGreaterThan(0);
    if (capability === 'submitted') expect(real.some((f) => f.expected.submitted !== null), 'needs a positive real capture').toBe(true);
  });
});

/**
 * Committed fixtures must not carry personal data. Real captures are sanitized in the page and
 * reviewed by hand; this is the backstop.
 */
describe('fixture privacy', () => {
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const PHONE = /(?:\+?\d[\d ()-]{8,}\d)/;
  // LinkedIn profile links other than the placeholder used in synthetic pages.
  const PROFILE = /linkedin\.com\/in\/(?!someone\b)|href="\/in\/(?!someone\/)/;

  it.each(fixtures)('$name has no emails, phone numbers or profile links', ({ html }) => {
    const body = html.replace(/^<!-- fixture: .*? -->/, '');
    // Long digit runs inside job ids/URLs aren't phone numbers: check visible text only.
    const text = new JSDOM(body).window.document.body?.textContent ?? '';
    expect(body.match(EMAIL)?.[0] ?? null).toBeNull();
    expect([...text.matchAll(new RegExp(PHONE, 'g'))].map((m) => m[0]).filter((m) => (m.match(/\d/g)?.length ?? 0) >= 10)).toEqual([]);
    expect(body.match(PROFILE)?.[0] ?? null).toBeNull();
  });
});

describe('job links', () => {
  it('unknown sites on http or a port keep their own address (canonical form is for matching only)', () => {
    const url = 'http://jobs.internal.example:8080/positions/7?utm_source=x';
    const doc = new JSDOM('<title>QA</title><h1>QA Lead</h1>', { url }).window.document;
    expect(extractJob(doc, url, { assumeJob: true })!.jobUrl).toBe('http://jobs.internal.example:8080/positions/7?utm_source=x');
  });
});
