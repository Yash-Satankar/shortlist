/**
 * CTC in lakhs per annum (LPA). The per-application "Expected CTC I gave" is stored as a
 * number of lakhs; people type "12", "12 LPA", "12.5 lpa", "₹12 L". Parsing is strict:
 * anything else (ranges, rupee amounts, notes) returns null rather than a guess.
 */
const LPA = /^(?:₹|rs\.?|inr)?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:lpa|l\.?p\.?a\.?|lakhs?|lacs?|l)?\s*(?:per\s+annum|p\.?\s*a\.?)?$/i;

export function parseLpa(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? text : null;
  const m = LPA.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n <= 1000 ? n : null;
}

/** Canonical stored form: "12", "12.5" (no unit, no trailing zeros). */
export function formatLpa(n: number): string {
  return String(Math.round(n * 100) / 100);
}
