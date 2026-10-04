import { describe, expect, it } from 'vitest';
import { reachPatch, reachShown } from '../src/lib/recruiter';

const both = { phone: '+91 90000 00000', linkedinUrl: 'https://linkedin.com/in/priya' };

describe('reachShown', () => {
  it('shows LinkedIn first, then phone', () => {
    expect(reachShown(both)).toBe('https://linkedin.com/in/priya');
    expect(reachShown({ phone: '+91 1', linkedinUrl: null })).toBe('+91 1');
    expect(reachShown(undefined)).toBe('');
  });
});

describe('reachPatch never drops the field that was not shown', () => {
  it('editing the shown LinkedIn URL keeps the phone', () => {
    expect(reachPatch('https://linkedin.com/in/priya-r', both)).toEqual({ linkedinUrl: 'https://linkedin.com/in/priya-r' });
  });

  it('editing the shown phone keeps the LinkedIn URL', () => {
    expect(reachPatch('+91 98888 88888', { phone: '+91 1', linkedinUrl: null })).toEqual({ phone: '+91 98888 88888' });
  });

  it('clearing the field clears only what it showed', () => {
    expect(reachPatch('', both)).toEqual({ linkedinUrl: null });
    expect(reachPatch('  ', { phone: '+91 1', linkedinUrl: null })).toEqual({ phone: null });
  });

  it('switching kind replaces the shown value and sets the typed one', () => {
    expect(reachPatch('+91 97777 77777', both)).toEqual({ phone: '+91 97777 77777', linkedinUrl: null });
    expect(reachPatch('linkedin.com/in/new', { phone: '+91 1', linkedinUrl: null })).toEqual({ linkedinUrl: 'linkedin.com/in/new', phone: null });
  });

  it('a new recruiter only gets the typed field', () => {
    expect(reachPatch('+91 1', undefined)).toEqual({ phone: '+91 1' });
    expect(reachPatch('', undefined)).toEqual({});
  });
});
