/**
 * Duplicate detection. Pure functions so the same scoring runs in the API, the web
 * form and the extension. The DB only pre-filters candidates (pg_trgm on company).
 *
 * Levels:
 * - exact:  same canonical job URL. Definitely the same posting.
 * - likely: same company and (near-)same role. Shown as a warning and needs confirmation.
 * - hint:   same company, different role. Informational only ("you also applied to X here").
 */

export type DuplicateLevel = 'exact' | 'likely' | 'hint';

export interface DuplicateSubject {
  companyNormalized: string;
  roleNormalized: string;
  jobUrlCanonical?: string | null;
}

/** Trigram set of a string, built like pg_trgm (each word padded with two leading spaces and one trailing). */
function trigrams(value: string): Set<string> {
  const grams = new Set<string>();
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Jaccard similarity of trigram sets, 0..1, matching pg_trgm's similarity(). */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Tokens that make two otherwise-similar titles different roles. */
const LEVEL_TOKENS = new Set([
  'intern',
  'trainee',
  'junior',
  'associate',
  'senior',
  'lead',
  'staff',
  'principal',
  'head',
  'manager',
  'director',
  'architect',
  'i',
  'ii',
  'iii',
  'iv',
  '1',
  '2',
  '3',
]);

const levelTokens = (role: string) => new Set(role.split(' ').filter((t) => LEVEL_TOKENS.has(t)));

function sameLevel(a: string, b: string): boolean {
  const la = levelTokens(a);
  const lb = levelTokens(b);
  return la.size === lb.size && [...la].every((t) => lb.has(t));
}

export const COMPANY_MATCH_THRESHOLD = 0.8;
export const ROLE_MATCH_THRESHOLD = 0.7;

export function scoreDuplicate(
  candidate: DuplicateSubject,
  existing: DuplicateSubject,
): { level: DuplicateLevel; roleSimilarity: number } | null {
  if (candidate.jobUrlCanonical && candidate.jobUrlCanonical === existing.jobUrlCanonical) {
    return { level: 'exact', roleSimilarity: 1 };
  }
  const companySim = trigramSimilarity(candidate.companyNormalized, existing.companyNormalized);
  if (companySim < COMPANY_MATCH_THRESHOLD) return null;

  const roleSimilarity = trigramSimilarity(candidate.roleNormalized, existing.roleNormalized);
  const likely =
    roleSimilarity >= ROLE_MATCH_THRESHOLD && sameLevel(candidate.roleNormalized, existing.roleNormalized);
  return { level: likely ? 'likely' : 'hint', roleSimilarity };
}

const LEVEL_ORDER: Record<DuplicateLevel, number> = { exact: 0, likely: 1, hint: 2 };

/** Scores every existing record and returns matches, strongest first. */
export function findDuplicates<T extends DuplicateSubject>(
  candidate: DuplicateSubject,
  existing: T[],
): Array<{ item: T; level: DuplicateLevel; roleSimilarity: number }> {
  return existing
    .map((item) => ({ item, score: scoreDuplicate(candidate, item) }))
    .filter((r): r is { item: T; score: NonNullable<typeof r.score> } => r.score !== null)
    .map(({ item, score }) => ({ item, ...score }))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.roleSimilarity - a.roleSimilarity);
}
