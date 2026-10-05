import type { SiteId } from '../lib/sites';

export type Capability = 'jobPage' | 'submitted' | 'applicationsList';
export const CAPABILITIES: readonly Capability[] = ['jobPage', 'submitted', 'applicationsList'];

/**
 * Which adapter capabilities are proven on REAL captured pages (sanitized fixtures from your
 * own browser), not just on synthetic ones. Set a flag to true only together with a real
 * fixture for it: fixtures.test.ts fails otherwise.
 *
 * What it changes: an unverified "submitted" marker reports with low confidence, so the
 * submission waits in Follow-ups for you to confirm instead of marking Applied.
 */
/**
 * "Submitted" is verified per marker (the specific confirmation signal a detector matched),
 * each backed by its own real capture: a site can have one proven marker and others not yet.
 */
export const SUBMITTED_MARKERS: Readonly<Record<SiteId, Readonly<Record<string, boolean>>>> = {
  linkedin: {
    'application status': true, // real capture: "Application status · Application submitted · now"
    'post-apply modal': false,
    'application sent dialog': false,
    'applied state': false,
  },
  greenhouse: { 'confirmation page': false, 'confirmation section': false },
  lever: { 'thanks page': false },
  naukri: { 'applied button': false },
  workday: { 'submitted dialog': false },
};

const anyMarker = (site: SiteId) => Object.values(SUBMITTED_MARKERS[site]).some(Boolean);

export const VERIFIED: Readonly<Record<SiteId, Readonly<Record<Capability, boolean>>>> = {
  linkedin: { jobPage: false, submitted: anyMarker('linkedin'), applicationsList: false },
  naukri: { jobPage: false, submitted: anyMarker('naukri'), applicationsList: false },
  greenhouse: { jobPage: false, submitted: anyMarker('greenhouse'), applicationsList: false },
  lever: { jobPage: false, submitted: anyMarker('lever'), applicationsList: false },
  workday: { jobPage: false, submitted: anyMarker('workday'), applicationsList: false },
};

declare const __JST_E2E_VERIFIED__: string[] | undefined;
/** Dev builds only (E2E): VITE_E2E_VERIFIED="site.capability,…". Always empty in production. */
const E2E_VERIFIED: string[] = __JST_DEV__ && typeof __JST_E2E_VERIFIED__ !== 'undefined' ? __JST_E2E_VERIFIED__ : [];

export const isVerified = (site: SiteId, capability: Capability) => VERIFIED[site][capability] || E2E_VERIFIED.includes(`${site}.${capability}`);

/** Is this specific submitted marker proven on a real capture? (E2E "site.submitted" covers all its markers.) */
export const isMarkerVerified = (site: SiteId, marker: string) => SUBMITTED_MARKERS[site][marker] === true || E2E_VERIFIED.includes(`${site}.submitted`);
