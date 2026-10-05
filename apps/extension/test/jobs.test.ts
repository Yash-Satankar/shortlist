import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractedJob } from '../src/adapters/types';

const store: Record<string, unknown> = { token: 'jt_' + 'a'.repeat(43) };
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
      set: async (patch: Record<string, unknown>) => void Object.assign(store, patch),
      remove: async () => undefined,
    },
  },
};

const { aiFill, checkDuplicates, draftFromJob, saveJob } = await import('../src/lib/jobs');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const sent = (i = 0) => ({ url: fetchMock.mock.calls[i]![0] as string, init: fetchMock.mock.calls[i]![1] as RequestInit & { headers: Record<string, string> }, body: JSON.parse(fetchMock.mock.calls[i]![1].body as string) });

const JOB: ExtractedJob = {
  roleTitle: 'Backend Engineer',
  companyName: 'Acme',
  location: 'Pune',
  workMode: 'hybrid',
  experienceAsked: '3-6 years',
  salaryListed: null,
  jd: 'Build APIs.',
  jobUrl: 'https://www.linkedin.com/jobs/view/4000000001/',
  externalId: '4000000001',
  source: 'linkedin',
  applyOnSite: true,
  origins: {},
  adapter: 'linkedin',
  missing: [],
};

describe('one-click save', () => {
  it('posts the edited draft as a user action with the canonical URL and source', async () => {
    fetchMock.mockResolvedValue(json(201, { application: { id: 'a1' } }));
    const draft = { ...draftFromJob(JOB), roleTitle: '  Senior Backend Engineer ', location: '', status: 'applied' as const };
    expect(await saveJob(JOB, draft, { confirmDuplicate: false })).toEqual({ id: 'a1' });
    const { url, init, body } = sent();
    expect(url).toMatch(/\/api\/applications$/);
    expect(init.headers['X-JT-Intent']).toBe('user');
    expect(body).toEqual({
      companyName: 'Acme',
      roleTitle: 'Senior Backend Engineer',
      location: null,
      workMode: 'hybrid',
      experienceAsked: '3-6 years',
      salaryListed: null,
      source: 'linkedin',
      jobUrl: 'https://www.linkedin.com/jobs/view/4000000001/',
      jd: 'Build APIs.',
      status: 'applied',
      confirmDuplicate: false,
    });
  });

  it('unknown site: no source or work mode sent (the server decides); empty JD omitted', async () => {
    fetchMock.mockResolvedValue(json(201, { application: { id: 'a2' } }));
    const job = { ...JOB, source: null, workMode: null, jd: null };
    await saveJob(job, draftFromJob(job), { confirmDuplicate: true });
    const { body } = sent();
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('workMode');
    expect(body).not.toHaveProperty('jd');
    expect(body.confirmDuplicate).toBe(true);
  });

  it('a likely duplicate comes back as a 409 with the matches (the form then offers "Save anyway")', async () => {
    fetchMock.mockResolvedValue(json(409, { error: { code: 'duplicate_likely', message: 'This looks like an application you already have', details: { matches: [{ id: 'x', level: 'likely' }] } } }));
    await expect(saveJob(JOB, draftFromJob(JOB), { confirmDuplicate: false })).rejects.toMatchObject({ status: 409, code: 'duplicate_likely', details: { matches: [{ id: 'x' }] } });
  });

  it('duplicate check sends URL + company + role', async () => {
    fetchMock.mockResolvedValue(json(200, { matches: [] }));
    await checkDuplicates({ companyName: ' Acme ', roleTitle: 'Engineer' }, JOB.jobUrl);
    expect(sent().body).toEqual({ companyName: 'Acme', roleTitle: 'Engineer', jobUrl: JOB.jobUrl });
  });

  it('AI fill-in asks only for the missing fields, as a user action', async () => {
    fetchMock.mockResolvedValue(json(200, { fields: { companyName: 'Acme' }, cached: false }));
    await aiFill(JOB, 'Jobs', 'page text', ['companyName']);
    const { url, init, body } = sent();
    expect(url).toMatch(/\/api\/ai\/extract-job$/);
    expect(init.headers['X-JT-Intent']).toBe('user');
    expect(body).toEqual({ url: JOB.jobUrl, title: 'Jobs', text: 'page text', missing: ['companyName'] });
  });
});
