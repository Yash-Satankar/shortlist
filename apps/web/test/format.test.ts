import { describe, expect, it } from 'vitest';
import { daysAgo, formatEventTime, relativeDays } from '../src/lib/format';

// 3 Oct 2026, 00:30 IST (= 2 Oct 19:00 UTC): just after midnight in India.
const NOW = new Date('2026-10-02T19:00:00Z');

describe('relative dates use calendar days in IST', () => {
  it('counts a date-only value from yesterday as 1 day, not "today"', () => {
    expect(daysAgo('2026-10-02', NOW)).toBe(1);
    expect(relativeDays('2026-10-02', NOW)).toBe('yesterday');
  });

  it('treats instants by their IST calendar date', () => {
    // 2 Oct 18:00 UTC = 2 Oct 23:30 IST → yesterday; 2 Oct 18:31 UTC = 3 Oct 00:01 IST → today
    expect(relativeDays('2026-10-02T18:00:00Z', NOW)).toBe('yesterday');
    expect(relativeDays('2026-10-02T18:31:00Z', NOW)).toBe('today');
  });

  it('scales to weeks and months', () => {
    expect(relativeDays('2026-09-23', NOW)).toBe('10d ago');
    expect(relativeDays('2026-09-01', NOW)).toBe('4w ago');
    expect(relativeDays('2026-06-01', NOW)).toBe('4mo ago');
  });
});

describe('formatEventTime', () => {
  it('shows only the date for date-only events (stored at 12:00 UTC)', () => {
    expect(formatEventTime('2026-09-30T12:00:00.000Z')).not.toMatch(/pm|am/i);
  });

  it('shows the time for real instants', () => {
    expect(formatEventTime('2026-10-03T05:04:00.000Z')).toMatch(/10:34\s?am/i);
  });
});

describe('display timezone follows the user setting', () => {
  it('defaults to Asia/Kolkata and switches to the user zone; ignores unknown zones', async () => {
    const { setDisplayTimezone, displayTimezone, relativeDays } = await import('../src/lib/format');
    expect(displayTimezone()).toBe('Asia/Kolkata');
    // 4 Oct 19:00 UTC: already Monday 5 Oct in India, still Sunday 4 Oct in London.
    const now = new Date('2026-10-04T19:00:00Z');
    expect(relativeDays('2026-10-04', now)).toBe('yesterday');
    setDisplayTimezone('Europe/London');
    expect(relativeDays('2026-10-04', now)).toBe('today');
    setDisplayTimezone('Not/AZone');
    expect(displayTimezone()).toBe('Europe/London');
    setDisplayTimezone('Asia/Kolkata');
  });
});

describe('week boundary for list grouping (Monday 00:00, display timezone)', () => {
  it('matches the server: Monday 00:30 IST is a new week; Sunday is the previous one', async () => {
    const { weekStart, isThisWeek } = await import('../src/lib/format');
    const monday0030Ist = new Date('2026-10-04T19:00:00Z');
    expect(weekStart(monday0030Ist)).toBe('2026-10-05');
    expect(isThisWeek('2026-10-04', monday0030Ist)).toBe(false); // Sunday
    expect(isThisWeek('2026-10-05', monday0030Ist)).toBe(true);
    // Wednesday: the week still starts on that Monday, not 7 days back.
    const wed = new Date('2026-10-07T06:00:00Z');
    expect(weekStart(wed)).toBe('2026-10-05');
    expect(isThisWeek('2026-10-02', wed)).toBe(false); // 5 days ago but last week
  });
});
