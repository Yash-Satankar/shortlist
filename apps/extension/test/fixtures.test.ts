import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractJob } from '../src/adapters/extract';

const DIR = path.resolve(import.meta.dirname, 'fixtures');

interface Header {
  url: string;
  synthetic?: boolean;
  assumeJob?: boolean;
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

  it.each(fixtures)('$name', ({ html, header, expected }) => {
    expect(header?.url, 'fixture header with a url').toBeTruthy();
    const job = extractJob(load(html, header!.url), header!.url, { assumeJob: header!.assumeJob });

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
