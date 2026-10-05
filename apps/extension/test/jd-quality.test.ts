import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { isNonContent } from '../src/adapters/dom';
import { jdQuality } from '../src/adapters/generic';

const REAL =
  'We are looking for a backend engineer. Responsibilities: build and run services, review code and mentor others. ' +
  'Requirements: 4+ years of experience with Node.js and Postgres, strong skills in API design and testing. ' +
  'You will work in a small product team that ships weekly and owns its services end to end, from design to on-call. ' +
  'Qualifications: a degree or equivalent experience. Nice to have: Kubernetes and Terraform. We offer flexible hours and a learning budget. ' +
  'About the team: six engineers and a designer working on billing, with weekly demos and a calm, written-first culture. You will pair with the tech lead during your first month.';
const BANNER =
  'We use cookies to offer you the best possible website experience. Your cookie preferences will be stored in your browser. ' +
  'You can accept all cookies or opt out of cookies used for advertising and tracking by third parties, as described in our privacy policy and cookie policy. ' +
  'We and our partners process personal data under legitimate interest. You can change your consent preferences at any time in the preference centre. '.repeat(3);

describe('JD quality gate', () => {
  it('accepts a real description', () => {
    expect(jdQuality(REAL, { needSignals: true })).toMatchObject({ ok: true });
  });
  it('rejects text under the minimum length', () => {
    expect(jdQuality('Responsibilities: build things.')).toMatchObject({ ok: false, reason: 'too_short' });
  });
  it('rejects consent and privacy text, however long', () => {
    expect(BANNER.length).toBeGreaterThan(600);
    expect(jdQuality(BANNER)).toMatchObject({ ok: false, reason: 'consent_text' });
  });
  it('a real JD that mentions privacy once still passes', () => {
    expect(jdQuality(`${REAL} Read our privacy policy to see how we handle applications.`).ok).toBe(true);
  });
  it('text found by shape alone must look like a job description', () => {
    const essay = 'The quick brown fox jumps over the lazy dog near the riverbank on a sunny afternoon. '.repeat(10);
    expect(jdQuality(essay, { needSignals: true })).toMatchObject({ ok: false, reason: 'no_jd_signals' });
    expect(jdQuality(essay).ok).toBe(true); // structured sources are trusted on signals
  });
});

describe('non-content detection', () => {
  const doc = new JSDOM(
    `<div id="onetrust-banner-sdk"></div><div id="CybotCookiebotDialog"></div><div id="truste-consent-track"></div><div id="didomi-host"></div>
     <div id="usercentrics-root"></div><div class="gdpr-bar"></div><div aria-label="Cookie consent"></div><div class="site-privacy-banner"></div>
     <div role="dialog"></div><div aria-modal="true"></div><div style="position: fixed"></div><div style="position: sticky"></div>
     <nav></nav><header></header><footer></footer><aside></aside><form></form>
     <div id="keep" class="job-description privacy-friendly-team"></div><article id="keep2"></article>`,
  ).window.document;
  it('consent managers, dialogs, overlays and page chrome are excluded; job containers are not', () => {
    const all = Array.from(doc.body.children);
    const kept = all.filter((e) => !isNonContent(e)).map((e) => e.id);
    expect(kept).toEqual(['keep', 'keep2']);
  });
});
