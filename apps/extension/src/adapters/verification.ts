import type { SiteId } from '../lib/sites';

export type Capability = 'jobPage' | 'submitted' | 'applicationsList';
export const CAPABILITIES: readonly Capability[] = ['jobPage', 'submitted', 'applicationsList'];

/**
 * Which adapter capabilities are proven on REAL captured pages (sanitized fixtures from your
 * own browser), not just on synthetic ones. Set a flag to true only together with a real
 * fixture for it: fixtures.test.ts fails otherwise.
 *
 * What it changes: an unverified "submitted" detector reports with low confidence, so the
 * submission waits in Follow-ups for you to confirm instead of marking Applied.
 */
export const VERIFIED: Readonly<Record<SiteId, Readonly<Record<Capability, boolean>>>> = {
  linkedin: { jobPage: false, submitted: false, applicationsList: false },
  naukri: { jobPage: false, submitted: false, applicationsList: false },
  greenhouse: { jobPage: false, submitted: false, applicationsList: false },
  lever: { jobPage: false, submitted: false, applicationsList: false },
  workday: { jobPage: false, submitted: false, applicationsList: false },
};

export const isVerified = (site: SiteId, capability: Capability) => VERIFIED[site][capability];
