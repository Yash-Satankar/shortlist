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
 * Page parts that are never job content: consent managers (OneTrust, Cookiebot, TrustArc,
 * Didomi, Usercentrics, generic cookie/consent banners), dialogs and modal overlays, and page
 * chrome (nav, header, footer, aside, forms).
 */
const NON_CONTENT = [
  '[id^="onetrust-"]', '.ot-sdk-container', '[id^="CybotCookiebot"]', '[id^="truste"]', '#consent_blackbar', '.truste_overlay',
  '#didomi-host', '[id^="didomi-"]', '.didomi-popup', '#usercentrics-root', '[id^="usercentrics"]', '#uc-banner', '.cc-window', '.cc-banner',
  'dialog', '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
  'nav', 'header', 'footer', 'aside', 'form', '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
].join(',');
/** id/class/aria-label words that mark consent and privacy notices. */
const CONSENT_HINT = /cookie|consent|gdpr|privacy[-_ ]?(?:banner|notice|popup|modal|bar|overlay)|onetrust|cookiebot|truste|didomi|usercentrics|\bcmp[-_]/i;

/** Fixed or sticky elements are overlays (banners, chat widgets, sticky bars), not the posting. */
function isOverlay(el: Element): boolean {
  const inline = (el as HTMLElement).style?.position;
  if (inline === 'fixed' || inline === 'sticky') return true;
  const view = el.ownerDocument.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return false;
  const pos = view.getComputedStyle(el).position;
  return pos === 'fixed' || pos === 'sticky';
}

export function isNonContent(el: Element): boolean {
  if (el.matches(NON_CONTENT)) return true;
  const hints = `${el.id} ${el.getAttribute('class') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
  if (CONSENT_HINT.test(hints)) return true;
  return isOverlay(el);
}

/** Is the element itself, or anything around it, non-content? */
export const insideNonContent = (el: Element): boolean => {
  for (let e: Element | null = el; e; e = e.parentElement) if (isNonContent(e)) return true;
  return false;
};

/**
 * Element → readable plain text: block elements become lines, list items get "• ",
 * headings stay on their own line. Non-content inside it is left out (see isNonContent).
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
    // Leave out what isn't job content inside it: a consent banner, a dialog, a form, nav…
    if (e !== el && isNonContent(e)) return;
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
