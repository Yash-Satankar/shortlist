import { describe, expect, it } from 'vitest';
import { guessFromJd, parseShare } from '../src/lib/share';

describe('parseShare (Android share sheet → quick-add)', () => {
  it('LinkedIn app: link inside text', () => {
    expect(parseShare({ text: 'https://www.linkedin.com/jobs/view/4100000101' })).toMatchObject({
      jobUrl: 'https://www.linkedin.com/jobs/view/4100000101',
      companyName: '',
      roleTitle: '',
    });
  });

  it('LinkedIn app: "Check out this job at <company>: <role>"', () => {
    const r = parseShare({ text: 'Check out this job at Contoso India: Node.js Developer https://www.linkedin.com/jobs/view/4100000101' });
    expect(r).toMatchObject({ companyName: 'Contoso India', roleTitle: 'Node.js Developer', jobUrl: 'https://www.linkedin.com/jobs/view/4100000101' });
  });

  it('LinkedIn page title from the browser share', () => {
    const r = parseShare({
      title: 'Lumen Browser hiring Backend Platform Engineer in Hyderabad, Telangana, India | LinkedIn',
      url: 'https://www.linkedin.com/jobs/view/4000000002/',
    });
    expect(r).toMatchObject({ companyName: 'Lumen Browser', roleTitle: 'Backend Platform Engineer', location: 'Hyderabad, Telangana, India' });
  });

  it('Naukri app boilerplate', () => {
    const r = parseShare({
      text: 'Hey, check out this job: Node JS Developer at Acme Software Pvt Ltd https://www.naukri.com/job-listings-node-js-developer-acme-pune-011025500123',
    });
    expect(r).toMatchObject({ roleTitle: 'Node JS Developer', companyName: 'Acme Software Pvt Ltd' });
    expect(r.jobUrl).toContain('naukri.com/job-listings');
  });

  it('dash-separated titles', () => {
    expect(parseShare({ title: 'Full Stack Engineer - Northwind Data - Remote' })).toMatchObject({
      roleTitle: 'Full Stack Engineer',
      companyName: 'Northwind Data',
      location: 'Remote',
    });
  });

  it('treats long shared text as the JD and keeps the url param', () => {
    const jd = 'About the role. '.repeat(30);
    const r = parseShare({ title: 'Backend Engineer at Helio', text: jd, url: 'https://jobs.lever.co/helio/abc' });
    expect(r.jd).toBe(jd.trim());
    expect(r).toMatchObject({ roleTitle: 'Backend Engineer', companyName: 'Helio', jobUrl: 'https://jobs.lever.co/helio/abc' });
  });

  it('copes with nothing useful', () => {
    expect(parseShare({})).toEqual({ jobUrl: '', companyName: '', roleTitle: '', location: '', jd: '' });
  });
});

describe('guessFromJd', () => {
  it('reads labelled lines', () => {
    expect(guessFromJd('Company: Acme Corp\nJob Title: Backend Engineer\nLocation: Pune\n\nWe are hiring…')).toEqual({
      companyName: 'Acme Corp',
      roleTitle: 'Backend Engineer',
      location: 'Pune',
    });
  });

  it('returns blanks when there are no labels', () => {
    expect(guessFromJd('We are a fast-growing startup…')).toEqual({ companyName: '', roleTitle: '', location: '' });
  });
});
