import type { WorkMode } from '@jt/shared';

/** Collapse runs of spaces (not newlines) and trim; empty → null. */
export function clean(text: string | null | undefined, max = 500): string | null {
  if (!text) return null;
  const t = text.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

/** First non-empty text among the selectors (in order). */
export function textOf(root: ParentNode, selectors: string[], max = 500): string | null {
  for (const sel of selectors) {
    for (const el of Array.from(root.querySelectorAll(sel))) {
      const t = clean(el.textContent, max);
      if (t) return t;
    }
  }
  return null;
}

/** First element matching any selector (in order). */
export function first(root: ParentNode, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL',
]);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'BUTTON', 'IFRAME', 'INPUT', 'SELECT', 'TEXTAREA']);

/**
 * Element → readable plain text: block elements become lines, list items get "• ",
 * headings stay on their own line. Independent of CSS (works in jsdom and on hidden nodes).
 */
export function elementToText(el: Element | null, max = 100_000): string | null {
  if (!el) return null;
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out.push((node.textContent ?? '').replace(/[\s ]+/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;
    const e = node as Element;
    const tag = e.tagName.toUpperCase();
    if (SKIP.has(tag) || e.getAttribute('aria-hidden') === 'true') return;
    if (tag === 'BR') return void out.push('\n');
    const block = BLOCK.has(tag);
    if (block) out.push('\n');
    if (tag === 'LI') out.push('• ');
    for (const child of Array.from(e.childNodes)) walk(child);
    if (block) out.push('\n');
  };
  walk(el);
  const text = out
    .join('')
    .split('\n')
    .map((l) => l.replace(/ +/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .replace(/^• $/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text.slice(0, max) : null;
}

/** A detached document with no browsing context: parsing into it runs no scripts and loads nothing. */
const inert = (doc: Document) => doc.implementation.createHTMLDocument('');

/** HTML string (e.g. a JSON-LD description) → plain text, parsed inertly (no scripts, no requests). */
export function htmlToText(html: string | null | undefined, doc: Document): string | null {
  if (!html) return null;
  // Some sites put entity-escaped HTML in JSON-LD ("&lt;p&gt;…"): decode once, inertly.
  if (/&lt;[a-z]/i.test(html) && !/<[a-z]/i.test(html)) {
    const ta = inert(doc).createElement('textarea');
    ta.innerHTML = html;
    html = ta.value;
  }
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    const t = html
      .split(/\r?\n/)
      .map((l) => l.replace(/[\s ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return t ? t.slice(0, 100_000) : null;
  }
  const wrap = inert(doc).createElement('div');
  wrap.innerHTML = html;
  return elementToText(wrap);
}

/** Work mode from free text ("Hybrid", "Remote", "On-site", "Work from office"). */
export function workModeFrom(text: string | null | undefined): WorkMode | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\bremote\b|work from home|\bwfh\b|telecommute/.test(t)) return 'remote';
  if (/\bon-?\s?site\b|in[- ]office|work from office|\bwfo\b/.test(t)) return 'onsite';
  return null;
}

export const metaContent = (doc: Document, key: string): string | null =>
  clean(doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content'));
