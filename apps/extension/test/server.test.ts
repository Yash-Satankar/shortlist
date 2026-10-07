import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, switchServer } from '../src/lib/server';

describe('self-hosted server address', () => {
  it('normalizes to an origin; https only, except localhost', () => {
    expect(normalizeServerUrl('tracker.example.com/settings')).toBe('https://tracker.example.com');
    expect(normalizeServerUrl(' https://Tracker.Example.com:8443/x ')).toBe('https://tracker.example.com:8443');
    expect(normalizeServerUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(() => normalizeServerUrl('http://tracker.example.com')).toThrow(/https/);
    expect(() => normalizeServerUrl('https://user:pw@tracker.example.com')).toThrow(/user name/);
    expect(() => normalizeServerUrl('')).toThrow();
  });

  it('is saved only if a ShortList server answers /api/health', async () => {
    const ok = (async () => new Response(JSON.stringify({ ok: true }))) as unknown as typeof fetch;
    const other = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    const down = (async () => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    await expect(switchServer('tracker.example.com', ok)).resolves.toBe('https://tracker.example.com');
    await expect(switchServer('tracker.example.com', other)).rejects.toThrow(/No ShortList server/);
    await expect(switchServer('tracker.example.com', down)).rejects.toThrow(/No ShortList server/);
  });
});
