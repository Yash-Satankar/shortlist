import { describe, expect, it } from 'vitest';
import { formatProfileAnswer, parseExperienceYears, parseNoticePeriodDays, profileFieldForQuestion } from '../src/profile';

describe('profileFieldForQuestion', () => {
  it.each([
    ['Total experience', 'totalExperienceYears'],
    ['Total Experience (in years)', 'totalExperienceYears'],
    ['Overall experience', 'totalExperienceYears'],
    ['Years of experience?', 'totalExperienceYears'],
    ['Notice period', 'noticePeriodDays'],
    ['Notice Period (days)?', 'noticePeriodDays'],
    ['Relocation', 'relocation'],
    ['Willing to relocate?', 'relocation'],
    ['Current location', 'currentLocation'],
    ['Current City', 'currentLocation'],
    ['Current CTC', 'currentCtc'],
    ['Current CTC (LPA)', 'currentCtc'],
    ['Expected CTC', 'expectedCtc'],
    ['Expected salary', 'expectedCtc'],
  ])('"%s" → %s', (question, field) => {
    expect(profileFieldForQuestion(question)).toBe(field);
  });

  it.each([
    'Years of experience with Node.js',
    'How many years of experience do you have with AWS?',
    'Node.js',
    'Experience with React',
    'Work authorisation (India)',
    'LinkedIn',
    'Notification preferences',
  ])('"%s" stays a library question', (question) => {
    expect(profileFieldForQuestion(question)).toBeNull();
  });
});

describe('formatting and parsing', () => {
  it('formats profile values as answers', () => {
    expect(formatProfileAnswer('noticePeriodDays', 0)).toBe('Immediate (0 days)');
    expect(formatProfileAnswer('noticePeriodDays', 30)).toBe('30 days');
    expect(formatProfileAnswer('totalExperienceYears', 3)).toBe('3 years');
    expect(formatProfileAnswer('totalExperienceYears', 1)).toBe('1 year');
    expect(formatProfileAnswer('relocation', null)).toBeNull();
  });

  it('parses free-text answers', () => {
    expect(parseNoticePeriodDays('Immediate (0 days)')).toBe(0);
    expect(parseNoticePeriodDays('2 months')).toBe(60);
    expect(parseExperienceYears('3 years')).toBe(3);
    expect(parseExperienceYears('2.5 yrs')).toBe(2.5);
  });
});
