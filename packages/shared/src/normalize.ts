/**
 * Normalizers used for matching (duplicates, email→application, import idempotency).
 * They must be deterministic and stable: changing them changes stored normalized values,
 * so any change needs a data migration that re-normalizes existing rows.
 */

const COMPANY_SUFFIXES = [
  'private limited',
  'pvt ltd',
  'pvt',
  'limited',
  'ltd',
  'llp',
  'llc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'plc',
  'technologies',
  'technology',
  'tech',
  'solutions',
  'systems',
  'services',
  'software',
  'labs',
  'india',
  'global',
  'group',
];

const suffixPattern = new RegExp(`(?:\\s+(?:${COMPANY_SUFFIXES.map((s) => s.replace(/ /g, '\\s+')).join('|')}))+$`);

function basicFold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/(?<![a-z0-9])\.|\.(?![a-z0-9])/g, ' ') // drop dots that aren't inside a token (keep "node.js")
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Lumen Browser Pvt. Ltd." → "lumen browser"; never strips the name down to nothing. */
export function normalizeCompanyName(name: string): string {
  const folded = basicFold(name.replace(/\([^)]*\)/g, ' '));
  const stripped = folded.replace(suffixPattern, '').trim();
  return stripped || folded;
}

const ROLE_SYNONYMS: Array<[RegExp, string]> = [
  [/\bsr\b/g, 'senior'],
  [/\bjr\b/g, 'junior'],
  [/\bdev\b/g, 'developer'],
  [/\bengg?\b/g, 'engineer'],
  [/\bswe\b/g, 'software engineer'],
  [/\bsde\b/g, 'software development engineer'],
  [/\bnode(?:[ .]?js)?\b/g, 'nodejs'],
  [/\breact(?:[ .]?js)?\b/g, 'react'],
  [/\bts\b/g, 'typescript'],
  [/\bjs\b/g, 'javascript'],
  [/\bback ?end\b/g, 'backend'],
  [/\bfront ?end\b/g, 'frontend'],
  [/\bfull ?stack\b/g, 'fullstack'],
];

/** Words that never distinguish one role from another (work mode, filler). */
const ROLE_NOISE =
  /\b(?:remote|hybrid|on ?site|onsite|wfh|work from home|full ?time|permanent|contract|immediate joiners?|urgent|hiring|and|of|the|for|with|in|at|to)\b/g;

/**
 * "Sr. Node.js Back-end Dev (Remote)" → "senior nodejs backend developer".
 * Parenthesized qualifiers are kept ("Full Stack Engineer (SDE II)" is a different role
 * from "Full Stack Engineer"); only noise words like "remote" are dropped.
 */
export function normalizeRoleTitle(title: string): string {
  let value = basicFold(title.replace(/[()[\]\-–—/|,]/g, ' '));
  for (const [pattern, replacement] of ROLE_SYNONYMS) value = value.replace(pattern, replacement);
  return value.replace(ROLE_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/** Screening questions: case/punctuation-insensitive key for the answer library. */
export function normalizeQuestion(question: string): string {
  return basicFold(question).replace(/[?.:]+$/g, '').trim();
}
