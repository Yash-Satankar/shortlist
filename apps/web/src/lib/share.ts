import { APPLICATION_SOURCE_LABELS, sourceFromHost } from '@jt/shared';

/**
 * Turns what Android's share sheet hands the PWA (title / text / url, via the GET
 * share target) into a quick-add prefill. Apps are inconsistent: LinkedIn often
 * puts the link inside `text`, Naukri adds "check out this job" boilerplate, and
 * browsers send the page title. Everything here is a best guess the user can edit.
 */

export interface SharePrefill {
  jobUrl: string;
  companyName: string;
  roleTitle: string;
  location: string;
  /** Long shared text is probably the JD itself. */
  jd: string;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/i;
const JD_MIN_LENGTH = 280;

const clean = (s: string | undefined) =>
  (s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”:,-]+|[\s"'“”:,.-]+$/g, '')
    .trim();

/** Ordered patterns over "title + text" (URL removed). First match wins. */
const PATTERNS: Array<{ re: RegExp; map: (m: RegExpExecArray) => Partial<SharePrefill> }> = [
  // LinkedIn page title: "Acme hiring Node.js Developer in Pune, Maharashtra, India | LinkedIn"
  {
    re: /^(.+?) hiring (.+?)(?: in (.+?))?(?: \| LinkedIn)?$/i,
    map: (m) => ({ companyName: m[1], roleTitle: m[2], location: m[3] }),
  },
  // LinkedIn app: "Check out this job at Acme: Node.js Developer"
  { re: /job at (.+?): (.+)$/i, map: (m) => ({ companyName: m[1], roleTitle: m[2] }) },
  // Naukri app: "… this job: Node JS Developer at Acme Pvt Ltd" / "Node JS Developer - Acme - Pune"
  { re: /(?:job|opening|opportunity)[^:]*: (.+?) (?:at|@) (.+)$/i, map: (m) => ({ roleTitle: m[1], companyName: m[2] }) },
  // "Node.js Developer at Acme" / "Node.js Developer @ Acme"
  { re: /^(.+?) (?:at|@) (.+)$/i, map: (m) => ({ roleTitle: m[1], companyName: m[2] }) },
  // "Node.js Developer - Acme - Pune" / "Node.js Developer | Acme"
  {
    re: /^(.+?) [|–—-] (.+?)(?: [|–—-] (.+?))?(?: [|–—-] (?:LinkedIn|Naukri(?:\.com)?|Indeed))?$/i,
    map: (m) => ({ roleTitle: m[1], companyName: m[2], location: m[3] }),
  },
];

const NOISE = /\b(LinkedIn|Naukri(?:\.com)?|Indeed|Glassdoor)\b/gi;

export function parseShare(params: { title?: string | null; text?: string | null; url?: string | null }): SharePrefill {
  const title = params.title ?? '';
  const text = params.text ?? '';
  const jobUrl = (params.url && URL_RE.exec(params.url)?.[0]) || URL_RE.exec(text)?.[0] || URL_RE.exec(title)?.[0] || '';

  const textWithoutUrl = text.replace(URL_RE, ' ').trim();
  const isJd = textWithoutUrl.length >= JD_MIN_LENGTH;

  // Short text is a caption worth parsing; a long one is the JD body.
  const candidates = [clean(title.replace(URL_RE, ' ')), isJd ? '' : clean(textWithoutUrl)].filter(Boolean);
  let guess: Partial<SharePrefill> = {};
  outer: for (const candidate of candidates) {
    for (const { re, map } of PATTERNS) {
      const m = re.exec(candidate);
      if (m) {
        guess = map(m);
        break outer;
      }
    }
  }

  return {
    jobUrl,
    companyName: clean(guess.companyName?.replace(NOISE, '')),
    roleTitle: clean(guess.roleTitle),
    location: clean(guess.location?.replace(NOISE, '')),
    jd: isJd ? textWithoutUrl : '',
  };
}

/** Best-effort company/role from labelled lines in a pasted JD ("Company: Acme", "Job Title: …"). */
export function guessFromJd(jd: string): { companyName: string; roleTitle: string; location: string } {
  const line = (re: RegExp) => clean(re.exec(jd)?.[1]);
  return {
    companyName: line(/^\s*(?:company(?: name)?|organi[sz]ation|employer)\s*[:\-–]\s*(.+)$/im),
    roleTitle: line(/^\s*(?:job title|role|position|designation|title)\s*[:\-–]\s*(.+)$/im),
    location: line(/^\s*(?:location|job location|city)\s*[:\-–]\s*(.+)$/im),
  };
}

/** "linkedin.com/jobs/view/…" → "LinkedIn" (shown as "shared · LinkedIn"); unknown sites → their host. */
export function sharedFrom(url: string): string | null {
  const source = sourceFromHost(url);
  if (source) return APPLICATION_SOURCE_LABELS[source];
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
