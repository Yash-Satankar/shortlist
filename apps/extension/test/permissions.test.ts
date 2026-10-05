import { beforeEach, describe, expect, it, vi } from 'vitest';

// chrome.permissions / chrome.scripting stubs: granted origins and registered scripts in memory.
const granted = new Set<string>();
const registered = new Map<string, chrome.scripting.RegisteredContentScript>();
const injected: unknown[] = [];
let pageResult: unknown = null;
let injectFails = false;

(globalThis as unknown as { chrome: unknown }).chrome = {
  permissions: {
    contains: async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o)),
    request: async ({ origins }: { origins: string[] }) => (origins.forEach((o) => granted.add(o)), true),
    remove: async ({ origins }: { origins: string[] }) => (origins.forEach((o) => granted.delete(o)), true),
  },
  scripting: {
    getRegisteredContentScripts: async () => [...registered.values()],
    registerContentScripts: async (scripts: chrome.scripting.RegisteredContentScript[]) => scripts.forEach((s) => registered.set(s.id, s)),
    unregisterContentScripts: async ({ ids }: { ids: string[] }) => ids.forEach((id) => registered.delete(id)),
    executeScript: vi.fn(async (inj: { files?: string[] }) => {
      if (injectFails) throw new Error('Cannot access a chrome:// URL');
      injected.push(inj);
      return inj.files ? [{ result: undefined }] : [{ result: pageResult }];
    }),
  },
};

const { disableSite, enableSite, siteStates, syncContentScripts, AUTO_READ_FILES } = await import('../src/lib/permissions');
const { readTab, UnreadablePageError } = await import('../src/lib/reads');

beforeEach(() => {
  granted.clear();
  registered.clear();
  injected.length = 0;
  injectFails = false;
});

describe('per-site permissions', () => {
  it('every site is off until switched on', async () => {
    expect(Object.values(await siteStates()).every((on) => !on)).toBe(true);
    await syncContentScripts();
    expect(registered.size).toBe(0);
  });

  it('switching a site on registers auto-read for that site only', async () => {
    await enableSite('linkedin');
    expect(await syncContentScripts()).toEqual({ registered: ['linkedin'], unregistered: [] });
    const s = registered.get('auto-read-linkedin')!;
    expect(s.matches).toEqual(['https://*.linkedin.com/*']);
    expect(s.js).toEqual(AUTO_READ_FILES);
    expect(s.runAt).toBe('document_idle');
    expect(registered.size).toBe(1);
  });

  it('a multi-origin site is on only when all its origins are granted', async () => {
    granted.add('https://*.myworkdayjobs.com/*');
    expect((await siteStates()).workday).toBe(false);
    await enableSite('workday');
    expect((await siteStates()).workday).toBe(true);
  });

  it('switching off gives the permission back and unregisters the script', async () => {
    await enableSite('greenhouse');
    await syncContentScripts();
    await disableSite('greenhouse');
    expect(granted.size).toBe(0);
    expect(await syncContentScripts()).toEqual({ registered: [], unregistered: ['greenhouse'] });
    expect(registered.size).toBe(0);
  });

  it('a permission removed outside the popup (chrome://extensions) also unregisters', async () => {
    await enableSite('lever');
    await syncContentScripts();
    granted.clear();
    await syncContentScripts();
    expect(registered.has('auto-read-lever')).toBe(false);
  });

  it('overlapping syncs never double-register', async () => {
    await enableSite('naukri');
    await Promise.all([syncContentScripts(), syncContentScripts(), syncContentScripts()]);
    expect([...registered.keys()]).toEqual(['auto-read-naukri']);
  });
});

describe('Sync this page', () => {
  it('injects the reader into the current tab once and returns its read', async () => {
    pageResult = { url: 'https://jobs.lever.co/acme/1', title: 'Engineer', site: 'lever', readAt: '2026-10-04T10:00:00.000Z' };
    expect(await readTab(7)).toEqual(pageResult);
    expect(injected[0]).toMatchObject({ target: { tabId: 7 }, files: ['content/reader.js'] });
  });

  it('pages Chrome won’t let us read give a clear error', async () => {
    injectFails = true;
    await expect(readTab(7)).rejects.toBeInstanceOf(UnreadablePageError);
  });
});
