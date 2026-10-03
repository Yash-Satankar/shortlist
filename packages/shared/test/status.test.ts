import { describe, expect, it } from 'vitest';
import type { ApplicationStatus, EventSource } from '../src/enums';
import { decideStatusChange, type SignalConfidence } from '../src/status';

const AUTOMATIC = ['extension_auto', 'portal', 'email', 'system'] as const;

const decide = (current: ApplicationStatus, proposed: ApplicationStatus, source: EventSource, confidence?: SignalConfidence) =>
  decideStatusChange({ current, proposed, source, confidence });

describe('manual changes', () => {
  it('always apply, in any direction', () => {
    expect(decide('interview', 'applied', 'manual').disposition).toBe('applied');
    expect(decide('rejected', 'interview', 'manual').disposition).toBe('applied');
    expect(decide('offer', 'withdrawn', 'manual').disposition).toBe('applied');
    expect(decide('applied', 'ghosted', 'manual').disposition).toBe('applied');
  });

  it('treat import, share-sheet capture and explicit extension clicks as user actions', () => {
    expect(decide('interview', 'applied', 'import').disposition).toBe('applied');
    expect(decide('saved', 'applied', 'share').disposition).toBe('applied');
    expect(decide('rejected', 'interview', 'extension')).toEqual({ disposition: 'applied', reason: 'user_action' });
    expect(decide('applied', 'offer', 'extension').disposition).toBe('applied');
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
    for (const source of AUTOMATIC) {
      expect(decide(current, proposed, source).disposition).toBe('ignored');
    }
  });

  it('applies forward moves', () => {
    expect(decide('applied', 'assessment', 'email')).toEqual({ disposition: 'applied', reason: 'forward' });
    expect(decide('saved', 'applied', 'extension_auto').disposition).toBe('applied');
    expect(decide('applied', 'shortlisted', 'portal').disposition).toBe('applied');
  });

});

describe('final states', () => {
  const OPEN: ApplicationStatus[] = ['saved', 'applied', 'viewed', 'assessment', 'shortlisted', 'interview', 'ghosted'];

  describe('LEAVING Offer / Rejected / Withdrawn automatically → always pending_review', () => {
    const proposals: ApplicationStatus[] = ['applied', 'viewed', 'assessment', 'shortlisted', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn'];

    it.each(['offer', 'rejected', 'withdrawn'] as const)('from %s, at any confidence', (current) => {
      for (const proposed of proposals.filter((p) => p !== current)) {
        for (const source of AUTOMATIC) {
          for (const confidence of ['high', 'low'] as const) {
            expect(decide(current, proposed, source, confidence)).toEqual({ disposition: 'pending_review', reason: 'locked' });
          }
        }
      }
    });
  });

  describe('INTO Rejected automatically', () => {
    it.each(OPEN)('from %s with a high-confidence signal → applied', (current) => {
      for (const source of AUTOMATIC) {
        expect(decide(current, 'rejected', source, 'high')).toEqual({ disposition: 'applied', reason: 'rejection' });
      }
    });

    it.each(OPEN)('from %s with a low-confidence signal → pending_review', (current) => {
      for (const source of AUTOMATIC) {
        expect(decide(current, 'rejected', source, 'low')).toEqual({ disposition: 'pending_review', reason: 'low_confidence' });
      }
    });

    it('treats an unspecified confidence as low', () => {
      expect(decide('interview', 'rejected', 'email').reason).toBe('low_confidence');
    });
  });

  describe('INTO Offer automatically → always pending_review (scam risk)', () => {
    it.each(OPEN)('from %s, even at high confidence', (current) => {
      for (const source of AUTOMATIC) {
        for (const confidence of ['high', 'low'] as const) {
          expect(decide(current, 'offer', source, confidence)).toEqual({ disposition: 'pending_review', reason: 'offer_needs_review' });
        }
      }
    });
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
    expect(decide('ghosted', 'rejected', 'email', 'high').disposition).toBe('applied');
  });

  it('ignore a late confirmation', () => {
    expect(decide('ghosted', 'applied', 'email').disposition).toBe('ignored');
  });
});
