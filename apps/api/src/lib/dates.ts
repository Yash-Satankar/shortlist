/** Today's calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Calendar date (YYYY-MM-DD) of an instant in the given timezone. */
export const dateIn = (instant: Date, timeZone: string) => todayIn(timeZone, instant);

export const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}
