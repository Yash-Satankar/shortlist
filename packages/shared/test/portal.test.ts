import { describe, expect, it } from 'vitest';
import { mapPortalLabel, portalReviewSchema, portalSyncRequestSchema } from '../src/portal';

describe('portal label mapping', () => {
  it.each([
    ['linkedin', 'Applied', 'applied'],
    ['linkedin', 'Application submitted', 'applied'],
    ['linkedin', 'Application viewed', 'viewed'],
    ['linkedin', 'Resume downloaded', 'viewed'],
    ['linkedin', 'No longer under consideration', 'rejected'],
    ['linkedin', 'Not selected', 'rejected'],
    ['naukri', 'Shortlisted', 'shortlisted'],
    ['naukri', 'Interview scheduled', 'interview'],
    ['naukri', 'Not shortlisted', 'rejected'],
    ['naukri', 'Viewed by recruiter', 'viewed'],
  ] as const)('%s "%s" → %s', (site, label, status) => {
    expect(mapPortalLabel(site, label)?.status).toBe(status);
  });

  it('closed jobs are informational: no status change', () => {
    expect(mapPortalLabel('linkedin', 'No longer accepting applications')).toEqual({ status: null, meaning: expect.stringMatching(/closed/) });
  });

  it('unknown labels are never guessed', () => {
    expect(mapPortalLabel('linkedin', 'Hiring team is reviewing')).toBeNull();
    expect(mapPortalLabel('naukri', 'Offer extended')).toBeNull(); // offers never come from a portal label
  });

  it('matches leading words only and is case/space-insensitive', () => {
    expect(mapPortalLabel('linkedin', '  application   VIEWED  3d ago')?.status).toBe('viewed');
    expect(mapPortalLabel('linkedin', 'Your profile was viewed')).toBeNull();
  });
});

describe('schemas', () => {
  it('sync request: https list page, bounded items, required title/company/label', () => {
    const item = { roleTitle: 'Engineer', companyName: 'Acme', statusLabel: 'Applied' };
    expect(portalSyncRequestSchema.safeParse({ site: 'linkedin', pageUrl: 'https://www.linkedin.com/my-items/saved-jobs/?cardType=APPLIED', items: [item], verified: false }).success).toBe(true);
    expect(portalSyncRequestSchema.safeParse({ site: 'linkedin', pageUrl: 'http://x', items: [item], verified: false }).success).toBe(false);
    expect(portalSyncRequestSchema.safeParse({ site: 'workday', pageUrl: 'https://x.example', items: [], verified: false }).success).toBe(false);
    expect(portalSyncRequestSchema.safeParse({ site: 'linkedin', pageUrl: 'https://x.example', items: [{ ...item, statusLabel: '' }], verified: false }).success).toBe(false);
  });

  it('review: something to do, no id both accepted and dismissed', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(portalReviewSchema.safeParse({ accept: [id] }).success).toBe(true);
    expect(portalReviewSchema.safeParse({}).success).toBe(false);
    expect(portalReviewSchema.safeParse({ accept: [id], dismiss: [id] }).success).toBe(false);
  });
});
