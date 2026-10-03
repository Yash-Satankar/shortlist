import { describe, expect, it } from 'vitest';
import type { ApplicationStatus, EventSource } from '../src/enums';
import { decideStatusChange } from '../src/status';

const decide = (current: ApplicationStatus, proposed: ApplicationStatus, source: EventSource) =>
  decideStatusChange({ current, proposed, source });

describe('manual changes', () => {
  it('always apply, in any direction', () => {
    expect(decide('interview', 'applied', 'manual').disposition).toBe('applied');
    expect(decide('rejected', 'interview', 'manual').disposition).toBe('applied');
    expect(decide('offer', 'withdrawn', 'manual').disposition).toBe('applied');
    expect(decide('applied', 'ghosted', 'manual').disposition).toBe('applied');
  });

  it('treat import and share-sheet capture as user actions', () => {
    expect(decide('interview', 'applied', 'import').disposition).toBe('applied');
    expect(decide('saved', 'applied', 'share').disposition).toBe('applied');
  });

  it('ignore a change to the same status', () => {
    expect(decide('applied', 'applied', 'manual')).toEqual({ disposition: 'ignored', reason: 'no_change' });
  });
});

describe('automatic sources never move a status backwards', () => {
  it('ignores an "Applied" email that arrives after Interview', () => {
    expect(decide('interview', 'applied', 'email')).toEqual({ disposition: 'ignored', reason: 'backwards' });
  });

  it.each<[ApplicationStatus, ApplicationStatus]>([
    ['shortlisted', 'viewed'],
    ['assessment', 'applied'],
    ['applied', 'saved'],
    ['interview', 'assessment'],
  ])('%s ← %s is ignored', (current, proposed) => {
    for (const source of ['email', 'portal', 'extension', 'system'] as const) {
      expect(decide(current, proposed, source).disposition).toBe('ignored');
    }
  });

  it('applies forward moves', () => {
    expect(decide('applied', 'assessment', 'email')).toEqual({ disposition: 'applied', reason: 'forward' });
    expect(decide('saved', 'applied', 'extension').disposition).toBe('applied');
    expect(decide('applied', 'shortlisted', 'portal').disposition).toBe('applied');
  });

  it('applies rejection and offer from any open stage', () => {
    expect(decide('interview', 'rejected', 'email')).toEqual({ disposition: 'applied', reason: 'outcome' });
    expect(decide('applied', 'offer', 'email').disposition).toBe('applied');
  });
});

describe('Offer, Rejected and Withdrawn are never changed automatically', () => {
  const locked: ApplicationStatus[] = ['offer', 'rejected', 'withdrawn'];
  const proposals: ApplicationStatus[] = ['applied', 'viewed', 'assessment', 'shortlisted', 'interview', 'offer', 'rejected', 'ghosted'];

  it.each(locked)('%s: every automatic proposal is flagged for review, never applied', (current) => {
    for (const proposed of proposals.filter((p) => p !== current)) {
      for (const source of ['email', 'portal', 'extension', 'system'] as const) {
        expect(decide(current, proposed, source)).toEqual({ disposition: 'pending_review', reason: 'locked' });
      }
    }
  });
});

describe('user-only targets', () => {
  it('flags automatic Ghosted / Withdrawn for review instead of applying', () => {
    expect(decide('applied', 'ghosted', 'system')).toEqual({ disposition: 'pending_review', reason: 'user_only_target' });
    expect(decide('interview', 'withdrawn', 'portal')).toEqual({ disposition: 'pending_review', reason: 'user_only_target' });
  });
});

describe('ghosted applications', () => {
  it('are revived by a real signal', () => {
    expect(decide('ghosted', 'interview', 'email')).toEqual({ disposition: 'applied', reason: 'revived' });
    expect(decide('ghosted', 'viewed', 'portal').disposition).toBe('applied');
    expect(decide('ghosted', 'rejected', 'email').disposition).toBe('applied');
  });

  it('ignore a late confirmation', () => {
    expect(decide('ghosted', 'applied', 'email').disposition).toBe('ignored');
  });
});
