import { describe, expect, it } from 'vitest';
import { normalizeCompanyName, normalizeQuestion, normalizeRoleTitle } from '../src/normalize';

describe('normalizeCompanyName', () => {
  it.each([
    ['Lumen Browser Pvt. Ltd.', 'lumen browser'],
    ['Northwind Data', 'northwind data'],
    ['Contoso India', 'contoso'],
    ['Infosys Limited', 'infosys'],
    ['Micro Integrated SemiConductor Systems Pvt Ltd', 'micro integrated semiconductor'],
    ['AT&T', 'at and t'],
    ['Acme Payments (via Naukri)', 'acme payments'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  it('never strips a name down to nothing', () => {
    expect(normalizeCompanyName('Technologies')).toBe('technologies');
    // Suffixes are only stripped after the first word, so the leading word always survives.
    expect(normalizeCompanyName('Tech Solutions')).toBe('tech');
  });
});

describe('normalizeRoleTitle', () => {
  it.each([
    ['Sr. Node.js Back-end Dev (Remote)', 'senior nodejs backend developer'],
    ['Node JS Developer', 'nodejs developer'],
    ['NodeJS Developer', 'nodejs developer'],
    ['Full-Stack Engineer', 'fullstack engineer'],
    ['SDE II', 'software development engineer ii'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRoleTitle(input)).toBe(expected);
  });
});

describe('normalizeQuestion', () => {
  it('ignores case and trailing punctuation', () => {
    expect(normalizeQuestion('Notice period?')).toBe(normalizeQuestion('notice  PERIOD'));
  });
});
