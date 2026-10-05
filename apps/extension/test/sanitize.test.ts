import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { extractJob } from '../src/adapters/extract';
import { sanitizeDocument, sanitizeUrl } from '../src/capture/sanitize';

const URL_ = 'https://www.linkedin.com/jobs/view/4000000009/?trk=abc&refId=xyz&currentJobId=4000000009';

// A logged-in job page carrying everything that must not end up in a committed fixture.
const PAGE = `<!doctype html><html><head>
<title>(2) Staff Engineer | Acme | LinkedIn</title>
<meta name="csrf-token" content="ajax:123456789">
<meta property="og:title" content="Staff Engineer at Acme">
<link rel="stylesheet" href="https://static.example/app.css">
<script>window.__user = {"name":"Priya Sharma","email":"priya.sharma@gmail.com"}</script>
<script type="application/ld+json">{"@type":"JobPosting","title":"Staff Engineer","hiringOrganization":{"name":"Acme"},"datePosted":"2026-09-30","description":"<p>Reach the recruiter at jobs@acme.example.</p>"}</script>
<style>.x{color:red}</style>
</head><body>
<header id="global-nav"><nav><img alt="Photo of Priya Sharma" src="https://media.example/priya.jpg"><span>Priya Sharma</span><a href="https://www.linkedin.com/in/priya-sharma-42/">Me</a></nav></header>
<!-- tracking comment with session 0xDEADBEEF -->
<main>
  <div class="job-details-jobs-unified-top-card__company-name" data-tracking-id="abc123" style="color:red"><a href="https://www.linkedin.com/company/acme/life/?trk=top">Acme</a></div>
  <div class="logo-wrap"><img alt="Acme logo" src="https://media.example/acme.png"></div>
  <div class="job-details-jobs-unified-top-card__job-title"><h1 onclick="track()">Staff Engineer</h1></div>
  <div class="job-details-jobs-unified-top-card__primary-description-container"><span class="tvm__text">Pune, India</span> · <span>Priya, you'd be a top applicant</span></div>
  <div id="job-details"><p>Call our recruiter on +91 98765 43210 or email hiring@acme.example. Posted 2026-09-30.</p><ul><li>Rust</li></ul></div>
  <section class="job-details-people-who-can-help__section"><a href="/in/rahul-recruiter/">Rahul Recruiter</a></section>
  <form><input name="phone" value="9876543210"><textarea>Cover letter for Priya</textarea></form>
  <div role="dialog"><p>Priya, upgrade to Premium</p></div>
</main>
<aside id="msg-overlay" aria-label="Messaging"><p>Chat with Anjali Rao</p></aside>
<footer>LinkedIn Corporation © 2026</footer>
</body></html>`;

const run = () => sanitizeDocument(new JSDOM(PAGE, { url: URL_ }).window.document, URL_, { userName: 'Priya Sharma', userEmail: 'priya.sharma@gmail.com', now: new Date('2026-10-05T00:00:00Z') });

describe('fixture sanitizer (dev-only capture)', () => {
  it('removes the account owner, other people, contact details and tracking', () => {
    const html = run();
    for (const leak of ['Priya', 'Sharma', 'priya.sharma@gmail.com', 'jobs@acme.example', 'hiring@acme.example', '98765', '9876543210', 'Rahul', 'Anjali', 'priya-sharma-42', 'rahul-recruiter', 'csrf', 'ajax:', 'DEADBEEF', 'trk=', 'refId', 'data-tracking-id', 'onclick', 'style=', 'media.example', 'window.__user', 'Cover letter', 'Premium', 'Messaging', '.x{color']) {
      expect(html, leak).not.toContain(leak);
    }
  });

  it('keeps what adapters need: structure, classes, JSON-LD, logo alt, safe links, dates', () => {
    const html = run();
    expect(html).toMatch(/^<!-- fixture: \{"url":"https:\/\/www\.linkedin\.com\/jobs\/view\/4000000009\/\?currentJobId=4000000009","captured":"2026-10-05","sanitizer":1\} -->/);
    expect(html).toContain('class="job-details-jobs-unified-top-card__job-title"');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('"datePosted":"2026-09-30"');
    expect(html).toContain('alt="Acme logo"');
    expect(html).toContain('href="/company/acme/life/"');
    expect(html).toContain('og:title');
    expect(html).toContain('[email]');
    expect(html).toContain('[phone]');
    expect(html).toContain('Test User, you');
  });

  it('the sanitized page still extracts the same job', () => {
    const html = run();
    const job = extractJob(new JSDOM(html, { url: URL_ }).window.document, URL_);
    expect(job).toMatchObject({ roleTitle: 'Staff Engineer', companyName: 'Acme', location: 'Pune, India', externalId: '4000000009' });
    expect(job!.jd).toContain('• Rust');
  });

  it('sanitizeUrl keeps host + path and job-id params only; drops non-http links', () => {
    expect(sanitizeUrl('https://boards.greenhouse.io/acme/jobs/1?gh_src=x&for=acme#apply')).toBe('https://boards.greenhouse.io/acme/jobs/1?for=acme');
    expect(sanitizeUrl('/in/someone-real/details', 'https://www.linkedin.com/')).toBe('https://www.linkedin.com/in/someone/details');
    expect(sanitizeUrl('mailto:me@example.com')).toBeNull();
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });
});
