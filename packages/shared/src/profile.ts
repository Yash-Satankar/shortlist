/**
 * Screening answers that are really facts about me live on the profile, not in the
 * answer library. The library shows them as generated, read-only entries, so there
 * is exactly one place to change e.g. my notice period.
 */

export interface ProfileAnswerValues {
  totalExperienceYears: number | null;
  noticePeriodDays: number | null;
  relocation: string | null;
  currentLocation: string | null;
  currentCtc: string | null;
  expectedCtc: string | null;
}
export type ProfileAnswerKey = keyof ProfileAnswerValues;

interface ProfileAnswerField {
  key: ProfileAnswerKey;
  /** Label used for the generated library entry. */
  question: string;
  /** Screening questions that this field answers. */
  match: RegExp;
  /** Encrypted at rest. */
  sensitive: boolean;
}

export const PROFILE_ANSWER_FIELDS: readonly ProfileAnswerField[] = [
  {
    key: 'totalExperienceYears',
    question: 'Total experience',
    // Overall experience only; "Years of experience with Node.js" is a library question.
    match: /^(total|overall)\s+(work\s+|professional\s+)?exp(erience)?\b|^(years of\s+)?(work\s+|professional\s+)?experience\s*(\(in years\))?\s*\??$/i,
    sensitive: false,
  },
  { key: 'noticePeriodDays', question: 'Notice period', match: /^notice( period)?\b/i, sensitive: false },
  { key: 'relocation', question: 'Relocation', match: /^(willing(ness)? to )?relocat/i, sensitive: false },
  { key: 'currentLocation', question: 'Current location', match: /^current (location|city)\b/i, sensitive: false },
  { key: 'currentCtc', question: 'Current CTC', match: /^current (ctc|salary|compensation)\b/i, sensitive: true },
  { key: 'expectedCtc', question: 'Expected CTC', match: /^(expected|desired) (ctc|salary|compensation)\b/i, sensitive: true },
];

export function profileFieldForQuestion(question: string): ProfileAnswerKey | null {
  const q = question.trim();
  return PROFILE_ANSWER_FIELDS.find((f) => f.match.test(q))?.key ?? null;
}

/** Text shown in the answer library / used to prefill a screening answer. */
export function formatProfileAnswer<K extends ProfileAnswerKey>(key: K, value: ProfileAnswerValues[K]): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (key === 'totalExperienceYears') {
    const n = Number(value);
    return `${n} ${n === 1 ? 'year' : 'years'}`;
  }
  if (key === 'noticePeriodDays') {
    const n = Number(value);
    return n === 0 ? 'Immediate (0 days)' : `${n} days`;
  }
  return String(value);
}

/** Parses free-text answers ("Immediate (0 days)", "2 months") back into profile values. */
export function parseNoticePeriodDays(answer: string): number | null {
  if (/immediate/i.test(answer)) return 0;
  const days = /(\d+)\s*days?/i.exec(answer);
  if (days) return Number(days[1]);
  const months = /(\d+)\s*months?/i.exec(answer);
  return months ? Number(months[1]) * 30 : null;
}

export function parseExperienceYears(answer: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(answer);
  return m ? Number(m[1]) : null;
}
