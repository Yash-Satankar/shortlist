/**
 * Build-time tunables (set VITE_* env vars when building; defaults below). Kept in one place so
 * every threshold the page readers use is visible and adjustable.
 */
declare const __JST_TUNING__: { jdMinChars: number; jdSettleMaxMs: number; jdSettleIdleMs: number } | undefined;

/** jdSettleIdleMs: how long to let a burst of page changes finish before re-checking. */
const defaults = { jdMinChars: 600, jdSettleMaxMs: 4000, jdSettleIdleMs: 400 };

export const TUNING: typeof defaults = typeof __JST_TUNING__ === 'undefined' ? defaults : { ...defaults, ...__JST_TUNING__ };
