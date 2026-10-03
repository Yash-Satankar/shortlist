/**
 * Domain enums shared by the API (Postgres enums), the web app and the extension.
 * Order matters for APPLICATION_STATUSES: it is the pipeline order used for display.
 */

export const APPLICATION_STATUSES = [
  'saved',
  'applied',
  'viewed',
  'assessment',
  'shortlisted',
  'interview',
  'offer',
  'rejected',
  'ghosted',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  viewed: 'Viewed',
  assessment: 'Assessment',
  shortlisted: 'Screening / Shortlisted',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
  withdrawn: 'Withdrawn',
};

/** Where a status change (or a record) came from. Shown on every timeline entry. */
export const EVENT_SOURCES = ['manual', 'import', 'share', 'extension', 'portal', 'email', 'system'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const WORK_MODES = ['onsite', 'hybrid', 'remote', 'unknown'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  unknown: 'Unknown',
};

/** Platform the application was submitted through. */
export const APPLICATION_SOURCES = [
  'linkedin',
  'naukri',
  'greenhouse',
  'lever',
  'workday',
  'company_portal',
  'referral',
  'email',
  'other',
] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export const APPLICATION_SOURCE_LABELS: Record<ApplicationSource, string> = {
  linkedin: 'LinkedIn',
  naukri: 'Naukri',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workday: 'Workday',
  company_portal: 'Company portal',
  referral: 'Referral',
  email: 'Email',
  other: 'Other',
};

export const CONTACT_ROLES = ['recruiter', 'hiring_manager', 'interviewer', 'referrer', 'other'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];
