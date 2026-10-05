import { canonicalJobUrl } from '@jt/shared';
import { siteForUrl, type SiteId } from '../lib/sites';
import { clean } from './dom';
import { isVerified } from './verification';

/**
 * "Application submitted" detectors. Conservative by design: each one requires the
 * platform's own confirmation marker (a specific dialog, URL or element), never generic
 * "thank you" text, because marking Applied when you only opened the form is worse than
 * missing a submission. Rendered DOM and URL only.
 */
export interface SubmittedSignal {
  site: SiteId;
  /** Which marker matched, e.g. "post-apply modal" (shown on the timeline). */
  signal: string;
  /** The job that was applied to (canonical), not the confirmation page's own URL. */
  jobUrl: string;
  /** Proven on real captures (high confidence) or not yet (low → review). */
  verified: boolean;
  /** The current page is the job page itself (its details can be read for a new save). */
  onJobPage: boolean;
  /**
   * A fresh confirmation (dialog/confirmation page right after submitting). A standing
   * "Applied 3 days ago" state is not fresh: it only updates jobs you already track and never
   * creates new ones while you browse.
   */
  fresh: boolean;
}

type Detector = (doc: Document, url: URL) => Omit<SubmittedSignal, 'site' | 'verified'> | null;

const canonical = (href: string) => canonicalJobUrl(href)?.canonical ?? null;
const textOf = (el: Element | null) => clean(el?.textContent) ?? '';

// ---------------------------------------------------------------- LinkedIn (Easy Apply)

/** "Applied 3 minutes ago" — LinkedIn's own state line on a job you've applied to. */
const LI_APPLIED_LINE = /^Applied (?:\d+|an?) (?:second|minute|hour|day|week|month|year)s? ago$/i;
/** The post-apply dialog's heading: "Your application was sent to Acme!" / "Application sent". */
const LI_SENT_HEADING = /^(?:your application was sent(?: to .+)?|application sent)!?$/i;

const linkedin: Detector = (doc, url) => {
  const jobUrl = canonical(url.href);
  if (!jobUrl) return null; // needs a job id: /jobs/view/<id> or ?currentJobId=<id>

  // 1) The post-apply dialog (fresh submission). Mid-flow Easy Apply steps ("Contact info",
  //    "Review your application", a "Submit application" button) have neither marker.
  const modal = doc.querySelector('[data-test-modal-id="post-apply-modal"]');
  if (modal) return { signal: 'post-apply modal', jobUrl, onJobPage: true, fresh: true };
  for (const dialog of Array.from(doc.querySelectorAll('[role="dialog"], .artdeco-modal'))) {
    if (dialog.querySelector('form, [aria-label*="Submit application" i], .jobs-easy-apply-content')) continue;
    for (const h of Array.from(dialog.querySelectorAll('h1, h2, h3'))) {
      if (LI_SENT_HEADING.test(textOf(h))) return { signal: 'application sent dialog', jobUrl, onJobPage: true, fresh: true };
    }
  }

  // 2) The job's own "Applied … ago" state in the top card (after the dialog closes, or revisits).
  for (const line of Array.from(doc.querySelectorAll('.artdeco-inline-feedback--success .artdeco-inline-feedback__message, .jobs-s-apply .artdeco-inline-feedback__message'))) {
    if (LI_APPLIED_LINE.test(textOf(line))) return { signal: 'applied state', jobUrl, onJobPage: true, fresh: false };
  }
  return null;
};

// ---------------------------------------------------------------- Greenhouse

const greenhouse: Detector = (doc, url) => {
  // Hosted boards redirect to …/jobs/<id>/confirmation after a successful submit.
  const m = /^\/([^/]+)\/jobs\/(\d+)\/confirmation\/?$/.exec(url.pathname);
  if (m) {
    const jobUrl = canonical(`${url.origin}/${m[1]}/jobs/${m[2]}`);
    return jobUrl ? { signal: 'confirmation page', jobUrl, onJobPage: false, fresh: true } : null;
  }
  // Legacy boards render the confirmation in place.
  if (doc.querySelector('#application_confirmation')) {
    const jobUrl = canonical(url.href);
    return jobUrl ? { signal: 'confirmation section', jobUrl, onJobPage: false, fresh: true } : null;
  }
  return null;
};

// ---------------------------------------------------------------- Lever

const lever: Detector = (_doc, url) => {
  // Lever sends you to …/<company>/<posting-id>/thanks after submitting.
  const m = /^\/([^/]+)\/([0-9a-f-]{36})\/thanks\/?$/i.exec(url.pathname);
  if (!m) return null;
  const jobUrl = canonical(`${url.origin}/${m[1]}/${m[2]}`);
  return jobUrl ? { signal: 'thanks page', jobUrl, onJobPage: false, fresh: true } : null;
};

// ---------------------------------------------------------------- Naukri

const naukri: Detector = (doc, url) => {
  const jobUrl = canonical(url.href);
  if (!jobUrl || !/job-listings-/.test(url.pathname)) return null;
  // After applying on Naukri the apply button is replaced by an "Applied" state.
  const applied = doc.querySelector('#already-applied, [class*="already-applied"]');
  if (applied && /^applied$/i.test(textOf(applied))) return { signal: 'applied button', jobUrl, onJobPage: true, fresh: false };
  return null;
};

// ---------------------------------------------------------------- Workday

const workday: Detector = (doc, url) => {
  // Workday's own post-submit dialog/page hooks. Job URL: the posting this flow came from.
  const done = doc.querySelector('[data-automation-id="congratulationsPopup"], [data-automation-id="applicationSubmittedPage"]');
  if (!done) return null;
  const jobUrl = canonical(url.href.replace(/\/apply(?:\/.*)?$/, ''));
  return jobUrl ? { signal: 'submitted dialog', jobUrl, onJobPage: false, fresh: true } : null;
};

const DETECTORS: Record<SiteId, Detector> = { linkedin, greenhouse, lever, naukri, workday };

/** A confirmed submission on this page, or null. Only for the job sites the extension knows. */
export function detectSubmitted(doc: Document, href: string): SubmittedSignal | null {
  const site = siteForUrl(href);
  if (!site) return null;
  const hit = DETECTORS[site.id](doc, new URL(href));
  return hit ? { ...hit, site: site.id, verified: isVerified(site.id, 'submitted') } : null;
}
