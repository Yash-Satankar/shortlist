import { describe, expect, it } from 'vitest';
import { canonicalJobUrl, sourceFromHost } from '../src/url';

describe('canonicalJobUrl', () => {
  it.each([
    ['https://www.linkedin.com/jobs/view/4100000101/', '4100000101'],
    ['https://in.linkedin.com/jobs/view/4100000101?refId=abc&trackingId=xyz', '4100000101'],
    ['https://www.linkedin.com/jobs/view/node-js-developer-at-contoso-4100000101', '4100000101'],
    ['https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4100000101', '4100000101'],
    ['https://www.linkedin.com/jobs/search/?currentJobId=4100000101&keywords=node', '4100000101'],
  ])('LinkedIn %s', (input, id) => {
    expect(canonicalJobUrl(input)).toEqual({
      canonical: `https://www.linkedin.com/jobs/view/${id}/`,
      externalId: id,
      source: 'linkedin',
    });
  });

  it('Greenhouse boards and embeds', () => {
    const expected = { canonical: 'https://job-boards.greenhouse.io/acme/jobs/7001234', externalId: '7001234', source: 'greenhouse' };
    expect(canonicalJobUrl('https://boards.greenhouse.io/acme/jobs/7001234?gh_src=abc')).toEqual(expected);
    expect(canonicalJobUrl('https://job-boards.greenhouse.io/Acme/jobs/7001234')).toEqual(expected);
    expect(canonicalJobUrl('https://boards.greenhouse.io/embed/job_app?for=acme&token=7001234')).toEqual(expected);
  });

  it('company site with gh_jid keeps the id and drops tracking', () => {
    const r = canonicalJobUrl('https://careers.acme.com/jobs/?gh_jid=7001234&utm_source=linkedin');
    expect(r).toEqual({ canonical: 'https://careers.acme.com/jobs?gh_jid=7001234', externalId: '7001234', source: 'greenhouse' });
  });

  it('Lever, with and without /apply', () => {
    const id = '0b5a6c1e-1111-2222-3333-444455556666';
    const expected = { canonical: `https://jobs.lever.co/acme/${id}`, externalId: id, source: 'lever' };
    expect(canonicalJobUrl(`https://jobs.lever.co/acme/${id}`)).toEqual(expected);
    expect(canonicalJobUrl(`https://jobs.lever.co/Acme/${id}/apply?lever-source=LinkedIn`)).toEqual(expected);
  });

  it('Workday, dropping locale and /apply', () => {
    const r = canonicalJobUrl(
      'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Bengaluru/Backend-Engineer_R-12345/apply/applyManually?source=LinkedIn',
    );
    expect(r).toEqual({
      canonical: 'https://acme.wd5.myworkdayjobs.com/Careers/job/Bengaluru/Backend-Engineer_R-12345',
      externalId: 'R-12345',
      source: 'workday',
    });
  });

  it('Naukri job listings', () => {
    const r = canonicalJobUrl('https://www.naukri.com/job-listings-node-js-developer-acme-pune-3-to-6-years-011025500123?src=jobsearchDesk');
    expect(r?.externalId).toBe('011025500123');
    expect(r?.canonical).toBe('https://www.naukri.com/job-listings-node-js-developer-acme-pune-3-to-6-years-011025500123');
  });

  it('generic URLs: lower-case host, sorted params, tracking and fragment dropped', () => {
    expect(canonicalJobUrl('https://Careers.Example.com/jobs/123/?b=2&utm_campaign=x&a=1#apply')?.canonical).toBe(
      'https://careers.example.com/jobs/123?a=1&b=2',
    );
  });

  it('rejects non-URLs', () => {
    expect(canonicalJobUrl('Open ↗')).toBeNull();
    expect(canonicalJobUrl('')).toBeNull();
    expect(canonicalJobUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('sourceFromHost', () => {
  it.each([
    ['https://www.linkedin.com/company/acme', 'linkedin'],
    ['https://in.linkedin.com/jobs/view/1', 'linkedin'],
    ['https://www.naukri.com/anything', 'naukri'],
    ['https://job-boards.greenhouse.io/x', 'greenhouse'],
    ['https://jobs.lever.co/x', 'lever'],
    ['https://acme.wd5.myworkdayjobs.com/x', 'workday'],
    ['https://careers.acme.com/jobs/1', null],
    ['not a url', null],
  ])('%s → %s', (url, source) => {
    expect(sourceFromHost(url)).toBe(source);
  });
});
