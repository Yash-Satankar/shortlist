import { describe, expect, it } from 'vitest';
import { findDuplicates, scoreDuplicate, trigramSimilarity } from '../src/duplicates';
import { normalizeCompanyName, normalizeRoleTitle } from '../src/normalize';
import { canonicalJobUrl } from '../src/url';

const subject = (company: string, role: string, url?: string) => ({
  companyNormalized: normalizeCompanyName(company),
  roleNormalized: normalizeRoleTitle(role),
  jobUrlCanonical: canonicalJobUrl(url)?.canonical ?? null,
});

describe('trigramSimilarity', () => {
  it('matches pg_trgm on simple cases', () => {
    expect(trigramSimilarity('word', 'word')).toBe(1);
    expect(trigramSimilarity('', '')).toBe(0);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
    // pg_trgm: similarity('word','two words') = 0.36363637
    expect(trigramSimilarity('word', 'two words')).toBeCloseTo(0.3636, 3);
  });
});

describe('real fixtures from my tracker: same company, different roles', () => {
  it('Lumen Browser: Backend Platform Engineer vs Full-Stack Engineer is at most a hint', () => {
    const result = scoreDuplicate(
      subject('Lumen Browser', 'Backend Platform Engineer'),
      subject('Lumen Browser', 'Full-Stack Engineer'),
    );
    expect(result?.level).toBe('hint');
  });

  it('Northwind Data: Senior SE (Node.js & TypeScript) vs Full-Stack Engineer (Node/TS/AWS) is at most a hint', () => {
    const result = scoreDuplicate(
      subject('Northwind Data', 'Senior Software Engineer (Node.js & TypeScript)'),
      subject('Northwind Data', 'Full-Stack Engineer (Node/TS/AWS)'),
    );
    expect(result?.level).toBe('hint');
  });

  it('neither pair produces a warning in findDuplicates', () => {
    const existing = [
      subject('Lumen Browser', 'Backend Platform Engineer', 'https://www.linkedin.com/jobs/view/4000000001/'),
      subject('Northwind Data', 'Full-Stack Engineer (Node/TS/AWS)', 'https://www.linkedin.com/jobs/view/4000000002/'),
    ];
    const lumen = findDuplicates(subject('Lumen Browser', 'Full-Stack Engineer', 'https://www.linkedin.com/jobs/view/4000000003/'), existing);
    const northwind = findDuplicates(
      subject('Northwind Data', 'Senior Software Engineer (Node.js & TypeScript)', 'https://www.linkedin.com/jobs/view/4000000004/'),
      existing,
    );
    expect(lumen.map((d) => d.level)).toEqual(['hint']);
    expect(northwind.map((d) => d.level)).toEqual(['hint']);
  });
});

describe('real duplicates', () => {
  it('same canonical URL is exact, even with different tracking params', () => {
    const a = subject('Contoso India', 'Node.js Developer', 'https://www.linkedin.com/jobs/view/4100000101/?trk=abc&refId=x');
    const b = subject('Contoso', 'Lead Node.js developer', 'https://in.linkedin.com/jobs/view/4100000101');
    expect(scoreDuplicate(a, b)?.level).toBe('exact');
  });

  it.each([
    ['Full Stack Engineer', 'Full-Stack Engineer'],
    ['Node JS Developer', 'Node.js Developer'],
    ['Sr. Backend Engineer', 'Senior Back-end Engineer (Remote)'],
    ['Fullstack Software Engineer', 'Full Stack Software Engineer'],
  ])('"%s" vs "%s" at the same company is likely', (a, b) => {
    expect(scoreDuplicate(subject('Acme Pvt Ltd', a), subject('ACME', b))?.level).toBe('likely');
  });

  it('a different level of the same title is only a hint', () => {
    expect(scoreDuplicate(subject('Acme', 'Software Engineer'), subject('Acme', 'Senior Software Engineer'))?.level).toBe('hint');
    expect(scoreDuplicate(subject('Acme', 'Software Engineer'), subject('Acme', 'Software Engineer II'))?.level).toBe('hint');
    expect(scoreDuplicate(subject('Acme', 'Full Stack Engineer'), subject('Acme', 'Full Stack Engineer (SDE II)'))?.level).toBe('hint');
  });

  it('different companies never match on role alone', () => {
    expect(scoreDuplicate(subject('Acme', 'Full Stack Engineer'), subject('Globex', 'Full Stack Engineer'))).toBeNull();
  });

  it('orders exact before likely before hint', () => {
    const existing = [
      subject('Acme', 'Data Engineer'),
      subject('Acme', 'Full Stack Engineer'),
      subject('Acme', 'Something else', 'https://jobs.lever.co/acme/0b5a6c1e-1111-2222-3333-444455556666'),
    ];
    const result = findDuplicates(
      subject('Acme', 'Full-Stack Engineer', 'https://jobs.lever.co/acme/0b5a6c1e-1111-2222-3333-444455556666/apply'),
      existing,
    );
    expect(result.map((r) => r.level)).toEqual(['exact', 'likely', 'hint']);
  });
});
