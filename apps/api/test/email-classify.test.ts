import { describe, expect, it } from 'vitest';
import { classifyEmail, isAtsDomain } from '../src/email/classify';

const c = (subject: string, text: string, fromDomain = 'acme.example') => classifyEmail({ subject, text, fromDomain });

describe('email classification (rules)', () => {
  it.each([
    ['received', 'Thank you for applying to Acme', 'We have received your application for Backend Engineer.'],
    ['received', 'Your application was sent to Globex', 'Your application was sent to Globex. Good luck!'],
    ['viewed', 'Your application was viewed by Hooli', 'A recruiter viewed your application.'],
    ['assessment', 'Next step: online assessment', 'Please complete the HackerRank coding test within 5 days.'],
    ['interview', 'Interview with Initech', 'We would like to invite you to an interview. Please share your availability for next week.'],
    ['rejected', 'Your application to Acme', 'Thank you for applying. Unfortunately, we have decided to move forward with other candidates.'],
    ['rejected', 'Update on your application', 'We regret to inform you that the position has been filled.'],
    ['offer', 'Offer letter – Backend Engineer', 'We are delighted to offer you the position. Please find the offer letter attached.'],
  ] as const)('%s: "%s"', (category, subject, text) => {
    expect(c(subject, text).category).toBe(category);
  });

  it('a rejection outranks the "thank you for applying" opener', () => {
    const r = c('Thank you for applying', 'Thank you for your interest in Acme. Unfortunately we will not be moving forward with your application.');
    expect(r.category).toBe('rejected');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8); // still a clear rejection
  });

  it('generic mail is "other": newsletters, job alerts, "interview tips"', () => {
    expect(c('10 new jobs for you', 'Software Engineer at Acme, Data Engineer at Globex').category).toBe('other');
    expect(c('Top interview tips for 2026', 'Read our guide to acing your next interview.').category).toBe('other');
    expect(c('Your weekly digest', 'Unfortunately the weather was bad this week.').category).toBe('other');
  });

  it('offers are proposed with moderate confidence (they are always reviewed anyway)', () => {
    expect(c('Job offer', 'We are pleased to extend you an offer.').confidence).toBeLessThan(0.8);
  });

  it('recognises applicant-tracking senders', () => {
    expect(isAtsDomain('greenhouse-mail.io')).toBe(true);
    expect(isAtsDomain('hire.lever.co')).toBe(true);
    expect(isAtsDomain('email.linkedin.com')).toBe(true);
    expect(isAtsDomain('acme.example')).toBe(false);
    expect(c('Thanks for applying', 'We have received your application', 'greenhouse-mail.io').fromAts).toBe(true);
  });
});
