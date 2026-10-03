import type { EventSource } from '@jt/shared';

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

/** Compact age for dense rows: "today", "3d", "2w", "4mo" (calendar days in IST). */
export function shortAge(value: string | null | undefined, now = new Date()): string {
  if (!value) return '';
  const days = daysAgo(value, now);
  if (days <= 0) return 'today';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/** "Sat 3 Oct" for follow-up dates. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }).replace(',', '');
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

