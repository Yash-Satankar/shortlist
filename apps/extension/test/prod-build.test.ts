import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The production build must not contain dev-only features, even when their switches are set
 * while building (the worst case): no pre-granted test hosts, no "verified" overrides, no
 * fixture-capture code. Checks the built files themselves, not runtime behaviour.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const TEST_HOSTS = 'https://*.greenhouse.io/*,https://*.linkedin.com/*';
const TEST_VERIFIED = 'linkedin.submitted,greenhouse.submitted';
let out = '';

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

beforeAll(() => {
  out = mkdtempSync(path.join(os.tmpdir(), 'jst-prod-'));
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'production', '--logLevel', 'error'], {
    cwd: ROOT,
    env: { ...process.env, JST_OUT_DIR: out, VITE_E2E_HOSTS: TEST_HOSTS, VITE_E2E_VERIFIED: TEST_VERIFIED },
    stdio: 'pipe',
  });
}, 120_000);
afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe('production build (dev switches set while building)', () => {
  it('grants only the tracker’s own host; job sites stay optional', () => {
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8')) as { name: string; permissions: string[]; host_permissions: string[]; optional_host_permissions: string[] };
    expect(manifest.permissions).toEqual(['storage', 'activeTab', 'scripting']); // no dev-only 'downloads'
    expect(manifest.host_permissions).toEqual(['https://your-shortlist.example.com/*']);
    expect(manifest.optional_host_permissions).toEqual(expect.arrayContaining(['https://*.linkedin.com/*', 'https://*.greenhouse.io/*']));
    expect(manifest.name).not.toMatch(/\(dev\)/);
  });

  it('ships no fixture-capture bundle', () => {
    expect(readdirSync(path.join(out, 'content')).sort()).toEqual(['auto.js', 'reader.js']);
  });

  it('no dev-only values or markers anywhere in the shipped files', () => {
    const text = files(out)
      .filter((f) => /\.(js|json|html|css)$/.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const marker of [
      ...TEST_VERIFIED.split(','), // "verified" overrides
      '__jstCapture',
      'sanitized fixture',
      'save-capture',
      'jst-captures',
      'localhost:5173',
      'localhost:3000',
    ]) {
      expect(text.includes(marker), `production build contains "${marker}"`).toBe(false);
    }
  });
});
