import type { ApplicationStatus, EventSource } from '@jt/shared';

const TZ = 'Asia/Kolkata';

/** "30 Sep" (or "30 Sep 2025" outside the current year). Date-only strings are never TZ-shifted. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: TZ });
}

/**
 * Date-only events (imports, back-dated entries) are stored at 12:00 UTC by the API;
 * showing "5:30 pm" for them would be invented precision.
 */
export function formatEventTime(value: string): string {
  return value.endsWith('T12:00:00.000Z') ? formatDate(value.slice(0, 10)) : formatDateTime(value);
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

const istDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Calendar days between a date/instant and today, both in IST (not rolling 24h windows). */
export function daysAgo(value: string, now = new Date()): number {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : istDate(new Date(value));
  return Math.round((Date.parse(istDate(now)) - Date.parse(day)) / 86_400_000);
}

/** "today", "yesterday", "5d ago", "3w ago" (calendar days in IST) */
export function relativeDays(value: string | null | undefined, now = new Date()): string {
  if (!value) return '';
  const days = daysAgo(value, now);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** YYYY-MM-DD for today + n days in IST (for follow-up snoozes). */
export function isoDateFromToday(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export const EVENT_SOURCE_LABELS: Record<EventSource, string> = {
  manual: 'You',
  import: 'Import',
  share: 'Shared',
  extension: 'Extension',
  extension_auto: 'Extension (auto)',
  portal: 'Portal sync',
  email: 'Email',
  system: 'System',
};

/** Explains why an automatic change didn't simply apply. */
export const REASON_LABELS: Record<string, string> = {
  backwards: 'Ignored: older than the current status',
  no_change: 'Ignored: already at this status',
  locked: 'Needs review: the status is final',
  offer_needs_review: 'Needs review: offers are always checked',
  low_confidence: 'Needs review: unclear signal',
  user_only_target: 'Needs review: only you can set this',
  rejection: 'Rejection detected',
  revived: 'Reopened after going quiet',
};

export const STATUS_STYLES: Record<ApplicationStatus, string> = {
  saved: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  applied: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  viewed: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  assessment: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  shortlisted: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  interview: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  offer: 'bg-green-600 text-white dark:bg-green-500 dark:text-green-950',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  ghosted: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  withdrawn: 'bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
};

/** Status filter groups for the list view. */
export const STATUS_GROUPS: Array<{ id: string; label: string; statuses: ApplicationStatus[] | null }> = [
  { id: 'active', label: 'Active', statuses: ['saved', 'applied', 'viewed', 'assessment', 'shortlisted', 'interview', 'offer'] },
  { id: 'applied', label: 'Waiting', statuses: ['applied', 'viewed'] },
  { id: 'progress', label: 'In progress', statuses: ['assessment', 'shortlisted', 'interview'] },
  { id: 'offer', label: 'Offers', statuses: ['offer'] },
  { id: 'closed', label: 'Closed', statuses: ['rejected', 'ghosted', 'withdrawn'] },
  { id: 'all', label: 'All', statuses: null },
];
