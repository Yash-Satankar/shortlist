import { describe, expect, it } from 'vitest';
import { buildManifest } from '../src/manifest';
import { SITES, siteForUrl } from '../src/lib/sites';

describe('site registry', () => {
  it.each([
    ['https://www.linkedin.com/jobs/view/123/', 'linkedin'],
    ['https://linkedin.com/jobs/', 'linkedin'],
    ['https://www.naukri.com/job-listings-x-123', 'naukri'],
    ['https://job-boards.greenhouse.io/acme/jobs/1', 'greenhouse'],
    ['https://boards.greenhouse.io/acme/jobs/1', 'greenhouse'],
    ['https://jobs.lever.co/acme/abc', 'lever'],
    ['https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x', 'workday'],
    ['https://wd3.myworkdaysite.com/recruiting/acme/x', 'workday'],
  ])('%s → %s', (url, id) => {
    expect(siteForUrl(url)?.id).toBe(id);
  });

  it.each([
    'https://notlinkedin.com/jobs',
    'https://linkedin.com.evil.example/jobs',
    'http://www.linkedin.com/jobs/',
    'chrome://extensions/',
    'not a url',
    undefined,
  ])('%s is not a known site', (url) => {
    expect(siteForUrl(url)).toBeNull();
  });

  it('the manifest asks for job sites (from the registry) and a self-hosted tracker only as optional permissions', () => {
    const m = buildManifest({ version: '1.0.0', apiOrigin: 'https://api.example', dev: false });
    expect(m.optional_host_permissions).toEqual([...SITES.flatMap((s) => s.origins), 'https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
    expect(m.host_permissions).toEqual(['https://api.example/*']);
    expect(m.permissions).toEqual(['storage', 'activeTab', 'scripting']);
    expect(JSON.stringify(m)).not.toMatch(/content_scripts|<all_urls>/);
  });
});
