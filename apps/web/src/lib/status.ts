import { APPLICATION_SOURCE_LABELS, isAutomaticSource, type ApplicationSource, type ApplicationStatus, type EventSource } from '@jt/shared';

/**
 * Display rules for the status system (see the design canvas):
 * hue + label say WHICH status, fill style says WHICH GROUP, the glyph works without colour.
 */

/** Short labels for pills, columns and chips. The full "Screening / Shortlisted" stays in STATUS_LABELS. */
export const STATUS_SHORT: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  viewed: 'Viewed',
  assessment: 'Assessment',
  shortlisted: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
  withdrawn: 'Withdrawn',
};

/** One-line hint shown next to each option in the status picker. */
export const STATUS_HINT: Partial<Record<ApplicationStatus, string>> = {
  saved: 'Not applied yet',
  viewed: 'Recruiter opened it',
  assessment: 'Test or assignment',
  shortlisted: 'Screening / Shortlisted',
  ghosted: 'No reply',
  withdrawn: 'You pulled out',
};

export const STATUS_GROUPS: Array<{ id: 'progress' | 'outcome' | 'closed'; label: string; statuses: ApplicationStatus[] }> = [
  { id: 'progress', label: 'In progress', statuses: ['saved', 'applied', 'viewed', 'assessment', 'shortlisted', 'interview'] },
  { id: 'outcome', label: 'Outcome', statuses: ['offer'] },
  { id: 'closed', label: 'Closed', statuses: ['rejected', 'ghosted', 'withdrawn'] },
];

export const ACTIVE_STATUSES: ApplicationStatus[] = ['saved', 'applied', 'viewed', 'assessment', 'shortlisted', 'interview', 'offer'];
export const CLOSED_STATUSES: ApplicationStatus[] = ['rejected', 'ghosted', 'withdrawn'];

/** Shorter source names for dense rows ("Company portal" → "Portal"). */
export function sourceShort(source: ApplicationSource): string {
  return source === 'company_portal' ? 'Portal' : APPLICATION_SOURCE_LABELS[source];
}

/** Timeline source badge text: lower-case, as in the component sheet. */
export const EVENT_SOURCE_BADGE: Record<EventSource, string> = {
  manual: 'manual',
  import: 'import',
  share: 'shared',
  extension: 'extension',
  extension_auto: 'extension auto',
  portal: 'portal',
  email: 'email',
  system: 'system',
};

export { isAutomaticSource };
