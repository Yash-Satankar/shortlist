import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RequestHandler } from 'express';

/**
 * GET /privacy: PRIVACY.md as a plain, readable page (the Chrome Web Store needs a public
 * privacy-policy URL). Rendered from the repo's PRIVACY.md (copied into the production image),
 * so the page and the document can't drift apart. Supports the subset PRIVACY.md uses:
 * headings, paragraphs, bullet lists, tables, **bold**, *italic* and `code`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
// apps/api/src or apps/api/dist → repo root (/app in the image)
const SOURCE = path.resolve(here, '../../../PRIVACY.md');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s: string) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
      i++;
    } else if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        const cells = lines[i]!.split('|').slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        `<table><thead><tr>${head!.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
    } else if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && (/^- /.test(lines[i]!) || /^ {2,}\S/.test(lines[i]!))) {
        if (/^- /.test(lines[i]!)) items.push(lines[i]!.slice(2));
        else items[items.length - 1] += ` ${lines[i]!.trim()}`;
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() && !/^(#{1,3} |- |\|)/.test(lines[i]!)) para.push(lines[i++]!.trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

const PAGE = (body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy · Job Status Tracker</title>
<style>
:root { color-scheme: light dark; --bg: #F5F5F1; --ink: #171716; --ink-2: #4A4A45; --line: #E2E2DC; --code: #ECECE6; }
@media (prefers-color-scheme: dark) { :root { --bg: #121211; --ink: #ECECE6; --ink-2: #A9A9A2; --line: #2A2A28; --code: #1F1F1D; } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 28px; line-height: 1.25; letter-spacing: -.02em; } h2 { font-size: 20px; margin-top: 32px; }
p, li { color: var(--ink-2); } strong { color: var(--ink); }
code { background: var(--code); padding: 1px 5px; border-radius: 5px; font-size: .9em; }
table { width: 100%; border-collapse: collapse; font-size: 15px; } th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
@media (max-width: 560px) { table, tbody, tr, td, th { display: block; } thead { display: none; } td:first-child { font-weight: 600; padding-bottom: 0; } }
</style></head><body><main>
${body}
</main></body></html>`;

let cached: string | null = null;

export const privacyPage: RequestHandler = (_req, res) => {
  if (cached === null) cached = existsSync(SOURCE) ? PAGE(markdownToHtml(readFileSync(SOURCE, 'utf8'))) : '';
  if (!cached) {
    res.status(404).type('text/plain').send('Privacy policy not found');
    return;
  }
  res.set('Cache-Control', 'public, max-age=3600').type('html').send(cached);
};
