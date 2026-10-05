/**
 * Sanitize a page saved with Chrome's "Save page as… → Webpage, Complete" into a fixture, using
 * the same sanitizer as the dev Capture button (scripts, chrome, attributes, links, emails,
 * phones and your name removed). The output still gets a manual review before it's committed.
 *
 *   pnpm --filter @jt/extension sanitize:capture <saved.html> <out.html> [--url <page url>] [--name "Your Name"] [--email you@example.com]
 *
 * The page URL is read from Chrome's "saved from url" comment, the canonical link or og:url when
 * --url isn't given. Parsing is inert: no scripts run and nothing is fetched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { sanitizeDocument } from '../src/capture/sanitize';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const url = flag('url');
const userName = flag('name') ?? null;
const userEmail = flag('email') ?? null;
const [input, output] = args;
if (!input || !output) {
  console.error('usage: sanitize-capture <saved.html> <out.html> [--url <page url>] [--name "Your Name"] [--email you@example.com]');
  process.exit(2);
}

const raw = readFileSync(input, 'utf8');
const savedFrom = /<!-- saved from url=\(\d+\)(\S+?) -->/.exec(raw)?.[1];
const probe = new JSDOM(raw).window.document;
const pageUrl =
  url ??
  savedFrom ??
  probe.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
  probe.querySelector('meta[property="og:url"]')?.getAttribute('content') ??
  null;
if (!pageUrl || !/^https?:\/\//.test(pageUrl)) {
  console.error('Could not tell which page this is: pass --url <the page address>.');
  process.exit(2);
}

const doc = new JSDOM(raw, { url: pageUrl }).window.document;
const html = sanitizeDocument(doc, pageUrl, { userName, userEmail });
writeFileSync(output, html);
console.log(`sanitized ${input} → ${output} (${html.length} bytes) for ${pageUrl}`);
