import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import { markdownToHtml } from '../src/privacy';

const app = createApp({ db: getDb() });
afterAll(closeDb);

describe('/privacy', () => {
  it('serves PRIVACY.md as a public page (no sign-in), with the key promises', async () => {
    const res = await request(app).get('/privacy');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<h1>Privacy: Job Status Tracker (Chrome extension)</h1>');
    expect(res.text).toContain('No passwords.');
    expect(res.text).toContain('<table>');
  });

  it('escapes HTML in the source', () => {
    expect(markdownToHtml('A <script>alert(1)</script> **b** `c`')).toBe('<p>A &lt;script&gt;alert(1)&lt;/script&gt; <strong>b</strong> <code>c</code></p>');
  });

  it('lists with continuation lines, headings and tables', () => {
    const html = markdownToHtml('# T\n\n- one\n  more\n- two\n\n| a | b |\n| --- | --- |\n| 1 | **2** |');
    expect(html).toBe('<h1>T</h1>\n<ul><li>one more</li><li>two</li></ul>\n<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table>');
  });
});
