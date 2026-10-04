import { describe, expect, it } from 'vitest';
import { formatLpa, parseLpa } from '../src/lpa';

describe('parseLpa', () => {
  it.each([
    ['12', 12],
    ['12 LPA', 12],
    ['12.5 lpa', 12.5],
    ['12.50', 12.5],
    ['₹12 L', 12],
    ['Rs. 9 lakhs', 9],
    ['INR 15 lpa', 15],
    ['7.5 lacs', 7.5],
    ['10 L.P.A.', 10],
    ['  18  ', 18],
  ])('"%s" → %s', (text, n) => {
    expect(parseLpa(text)).toBe(n);
  });

  it.each(['12-15 LPA', '1200000', '14 LPA (1400000)', 'negotiable', '', 'twelve', '12 crore', '-5'])('"%s" is not guessed', (text) => {
    expect(parseLpa(text)).toBeNull();
  });

  it('accepts numbers as-is', () => {
    expect(parseLpa(12.5)).toBe(12.5);
    expect(parseLpa(null)).toBeNull();
  });

  it('formats the canonical stored value', () => {
    expect(formatLpa(12)).toBe('12');
    expect(formatLpa(12.5)).toBe('12.5');
    expect(formatLpa(12.499)).toBe('12.5');
  });
});
