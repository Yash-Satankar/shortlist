/**
 * DEV-ONLY. Turns the page you're viewing into a fixture that's safe to commit. Built only into
 * development builds (content/capture.js); production and Web Store builds don't contain it.
 *
 * What it does, on a detached copy (the live page is never touched):
 * - keeps JSON-LD, drops every other script, style, frame, media and comment;
 * - drops page chrome where personal data lives: global nav, messaging, sidebars, dialogs,
 *   forms, "people who can help", footers;
 * - keeps only attributes adapters rely on (class, id, data-automation-id/qa/testid, role,
 *   aria-label/hidden, alt on logos, a few meta tags) and reduces links to host + path;
 * - replaces emails, phone numbers, profile links and the paired account's name everywhere.
 * A human still reviews every capture before it's committed.
 */

export const SANITIZER_VERSION = 1;

export interface SanitizeOptions {
  /** The paired account: its name and email are scrubbed wherever they appear. */
  userName?: string | null;
  userEmail?: string | null;
  now?: Date;
}

const REMOVE = [
  'script:not([type="application/ld+json"])',
  'style', 'link', 'noscript', 'iframe', 'frame', 'object', 'embed', 'video', 'audio', 'canvas', 'svg', 'template', 'picture source',
  'nav', 'footer', 'aside', 'dialog', 'form', 'input', 'textarea', 'select',
  'body > header', '[role="banner"]', '[role="navigation"]', '[role="contentinfo"]', '[role="complementary"]', '[role="dialog"]', '[aria-modal="true"]',
  '#global-nav', '#msg-overlay', '[aria-label*="messag" i]', '[class*="msg-overlay"]',
  '[class*="people-who-can-help"]', '[class*="hirer-card"]', '[class*="premium"]', '[class*="feed-identity"]', '[class*="global-footer"]',
  '[data-automation-id="headerNav"]', '[data-automation-id="utilityMenu"]',
];

const KEEP_ATTRS = new Set(['class', 'id', 'data-automation-id', 'data-qa', 'data-testid', 'role', 'aria-label', 'aria-hidden', 'lang', 'dir', 'type', 'href', 'alt', 'property', 'name', 'content', 'title', 'datetime']);
const KEEP_META = /^(og:title|og:site_name|og:type|description)$/i;
const KEEP_QUERY = new Set(['currentJobId', 'gh_jid', 'token', 'for']);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w/])\+?\d[\d ()-]{8,}\d(?![\w/])/g;
const PROFILE_PATH = /\/in\/[^/?#\s"]+\/?/g;

/** 10+ digits: a phone number, not a date (2025-10-04) or a short id. */
export const isPhone = (s: string) => (s.match(/\d/g)?.length ?? 0) >= 10;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scrubber(opts: SanitizeOptions): (text: string) => string {
  const names = [opts.userName?.trim(), ...(opts.userName?.trim().split(/\s+/).filter((p) => p.length >= 3) ?? [])].filter((n): n is string => !!n);
  const nameRe = names.length ? new RegExp(`\\b(?:${names.map(escapeRe).join('|')})\\b`, 'gi') : null;
  const emailRe = opts.userEmail ? new RegExp(escapeRe(opts.userEmail), 'gi') : null;
  return (text) => {
    let t = text;
    if (emailRe) t = t.replace(emailRe, '[email]');
    t = t.replace(EMAIL, '[email]').replace(PHONE, (m) => (isPhone(m) ? '[phone]' : m));
    if (nameRe) t = t.replace(nameRe, 'Test User');
    return t;
  };
}

/** Host + path only (no query except job ids, no hash); profile links become a placeholder. */
export function sanitizeUrl(href: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const params = [...u.searchParams.entries()].filter(([k]) => KEEP_QUERY.has(k));
  const path = u.pathname.replace(PROFILE_PATH, '/in/someone/');
  return `${u.origin}${path}${params.length ? `?${new URLSearchParams(params)}` : ''}`;
}

export function sanitizeDocument(doc: Document, pageUrl: string, opts: SanitizeOptions = {}): string {
  const scrub = scrubber(opts);
  const out = doc.implementation.createHTMLDocument('');
  const root = out.importNode(doc.documentElement, true) as HTMLElement;
  out.replaceChild(root, out.documentElement);

  for (const el of Array.from(root.querySelectorAll(REMOVE.join(',')))) el.remove();
  for (const m of Array.from(root.querySelectorAll('meta'))) {
    if (!KEEP_META.test(m.getAttribute('property') ?? m.getAttribute('name') ?? '')) m.remove();
  }
  // Images: only logos survive (as alt text, no src); avatars and photos carry names.
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const alt = img.getAttribute('alt') ?? '';
    const logo = /logo/i.test(alt) || Boolean(img.closest('[class*="logo" i]'));
    if (!logo) img.remove();
  }

  const walker = out.createTreeWalker(root, 0x1 | 0x4 | 0x80); // elements, text, comments
  const comments: Node[] = [];
  for (let n: Node | null = walker.currentNode; n; n = walker.nextNode()) {
    if (n.nodeType === 8) comments.push(n);
    else if (n.nodeType === 3) n.textContent = scrub(n.textContent ?? '');
    else if (n.nodeType === 1) {
      const el = n as Element;
      for (const a of Array.from(el.attributes)) {
        if (!KEEP_ATTRS.has(a.name) || (a.name === 'content' && el.tagName !== 'META')) el.removeAttribute(a.name);
        else if (a.name === 'href') {
          const safe = sanitizeUrl(a.value, pageUrl);
          if (safe) el.setAttribute('href', safe.startsWith(new URL(pageUrl).origin) ? safe.slice(new URL(pageUrl).origin.length) || '/' : safe);
          else el.removeAttribute('href');
        } else el.setAttribute(a.name, scrub(a.value));
      }
    }
  }
  for (const c of comments) c.parentNode?.removeChild(c);

  const header = { url: sanitizeUrl(pageUrl), captured: (opts.now ?? new Date()).toISOString().slice(0, 10), sanitizer: SANITIZER_VERSION };
  return `<!-- fixture: ${JSON.stringify(header)} -->\n<!doctype html>\n${root.outerHTML}\n`;
}
