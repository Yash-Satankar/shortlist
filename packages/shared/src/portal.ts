import { z } from 'zod';
import type { ApplicationStatus } from './enums';

/**
 * Portal sync: the extension reads your applications list on a job portal (only on a site you
 * switched on, only the rendered page), the server diffs it against your tracker, and you
 * review the proposed changes. Nothing is applied without your confirmation.
 */
export const PORTAL_SITES = ['linkedin', 'naukri'] as const;
export type PortalSite = (typeof PORTAL_SITES)[number];

export const PORTAL_SITE_LABELS: Record<PortalSite, string> = { linkedin: 'LinkedIn', naukri: 'Naukri' };

export const portalItemSchema = z.object({
  /** The portal's job id, when the list shows one. */
  externalId: z.string().trim().max(100).optional(),
  jobUrl: z.url({ protocol: /^https?$/ }).max(2000).optional(),
  roleTitle: z.string().trim().min(1).max(300),
  companyName: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).optional(),
  /** The status exactly as the portal shows it ("Application viewed"). Kept as evidence. */
  statusLabel: z.string().trim().min(1).max(200),
  /** The portal's own time text for that status, if shown ("3d ago"). */
  statusAt: z.string().trim().max(100).optional(),
});
export type PortalItem = z.infer<typeof portalItemSchema>;

export const portalSyncRequestSchema = z.object({
  site: z.enum(PORTAL_SITES),
  /** The list page that was read (for the snapshot; tracking parameters are dropped server-side). */
  pageUrl: z.url({ protocol: /^https$/ }).max(2000),
  items: z.array(portalItemSchema).max(500),
  /** The list reader is proven on a real capture (see the extension's verification registry). */
  verified: z.boolean(),
});
export type PortalSyncRequest = z.infer<typeof portalSyncRequestSchema>;

/** What a portal label means for the tracker. `null` status: informational, no status change. */
export interface PortalLabelMeaning {
  status: ApplicationStatus | null;
  /** Shown in review: why this label maps where it does. */
  meaning: string;
}

/**
 * Label → status, per portal. Matching is on the label's leading words, case-insensitive.
 * Labels nobody has mapped are reported as "unknown" and never guessed.
 * PROVISIONAL until each portal's applications list is verified on a real capture.
 */
const LABELS: Record<PortalSite, Array<[RegExp, PortalLabelMeaning]>> = {
  linkedin: [
    [/^(?:application )?(?:submitted|applied|sent)\b/i, { status: 'applied', meaning: 'Applied' }],
    [/^(?:application viewed|viewed)\b/i, { status: 'viewed', meaning: 'Recruiter viewed your application' }],
    [/^resume downloaded\b/i, { status: 'viewed', meaning: 'Recruiter downloaded your resume' }],
    [/^(?:not selected|no longer under consideration|application rejected|rejected)\b/i, { status: 'rejected', meaning: 'Not moving forward' }],
    [/^no longer accepting applications\b/i, { status: null, meaning: 'The job closed (your status is unchanged)' }],
  ],
  naukri: [
    [/^applied\b/i, { status: 'applied', meaning: 'Applied' }],
    [/^(?:application viewed|viewed by recruiter|recruiter viewed)\b/i, { status: 'viewed', meaning: 'Recruiter viewed your application' }],
    [/^shortlisted\b/i, { status: 'shortlisted', meaning: 'Shortlisted' }],
    [/^interview(?: scheduled)?\b/i, { status: 'interview', meaning: 'Interview' }],
    [/^(?:not shortlisted|not selected|rejected)\b/i, { status: 'rejected', meaning: 'Not moving forward' }],
    [/^(?:job )?(?:expired|closed)\b/i, { status: null, meaning: 'The job closed (your status is unchanged)' }],
  ],
};

/** The meaning of a portal's status label, or null when nobody has mapped that label yet. */
export function mapPortalLabel(site: PortalSite, label: string): PortalLabelMeaning | null {
  const l = label.trim().replace(/\s+/g, ' ');
  return LABELS[site].find(([re]) => re.test(l))?.[1] ?? null;
}

export const PORTAL_DECISIONS = ['pending', 'accepted', 'dismissed', 'superseded'] as const;
export type PortalDecision = (typeof PORTAL_DECISIONS)[number];

export const portalReviewSchema = z
  .object({ accept: z.array(z.uuid()).max(500).default([]), dismiss: z.array(z.uuid()).max(500).default([]) })
  .refine((v) => v.accept.length + v.dismiss.length > 0, 'Nothing to review')
  .refine((v) => !v.accept.some((id) => v.dismiss.includes(id)), 'An item can’t be both accepted and dismissed');
