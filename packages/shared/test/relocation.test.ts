import { describe, expect, it } from 'vitest';
import { composeRelocation, parseRelocation } from '../src/relocation';

describe('relocation text ↔ willing + preference', () => {
  it.each([
    ['Yes (Hyderabad preferred)', { willing: true, preference: 'Hyderabad preferred' }],
    ['Yes', { willing: true, preference: null }],
    ['No', { willing: false, preference: null }],
    ['No (family reasons)', { willing: false, preference: 'family reasons' }],
  ])('canonical "%s" round-trips exactly', (text, parsed) => {
    expect(parseRelocation(text)).toEqual(parsed);
    expect(composeRelocation(parseRelocation(text))).toBe(text);
  });

  it.each([
    ['Yes: Bengaluru, Pune', { willing: true, preference: 'Bengaluru, Pune' }, 'Yes (Bengaluru, Pune)'],
    ['yes, Hyderabad preferred', { willing: true, preference: 'Hyderabad preferred' }, 'Yes (Hyderabad preferred)'],
    ['  YES  ', { willing: true, preference: null }, 'Yes'],
    ['n - only remote', { willing: false, preference: 'only remote' }, 'No (only remote)'],
  ])('"%s" normalises without losing information', (text, parsed, composed) => {
    expect(parseRelocation(text)).toEqual(parsed);
    expect(composeRelocation(parseRelocation(text))).toBe(composed);
  });

  it.each(['Open to Pune', 'Maybe, depends on CTC', 'Willing for Bengaluru only', 'Yesterday I said no', 'Indore only'])(
    'ambiguous "%s" keeps the raw text and leaves willing unknown',
    (text) => {
      expect(parseRelocation(text)).toEqual({ willing: null, preference: text });
      expect(composeRelocation(parseRelocation(text))).toBe(text);
    },
  );

  it('empty means nothing set', () => {
    expect(parseRelocation('')).toEqual({ willing: null, preference: null });
    expect(parseRelocation(null)).toEqual({ willing: null, preference: null });
    expect(composeRelocation({ willing: null, preference: null })).toBeNull();
  });
});
