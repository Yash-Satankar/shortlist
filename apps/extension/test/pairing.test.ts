import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal chrome.storage.local stub (in-memory), installed before the modules load.
const store: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
      set: async (patch: Record<string, unknown>) => void Object.assign(store, patch),
      remove: async (keys: string[]) => keys.forEach((k) => delete store[k]),
    },
  },
};

const { apiFetch } = await import('../src/lib/api');
const { connect, disconnect } = await import('../src/lib/pairing');

const TOKEN = 'jt_' + 'a'.repeat(43);
const fetchMock = vi.fn();

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  store.apiOrigin = 'https://tracker.example.com'; // the address you entered in the popup
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });

describe('apiFetch', () => {
  it('sends the bearer token and the declared intent on every request', async () => {
    store.token = TOKEN;
    store.apiOrigin = 'https://tracker.example.com';
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await apiFetch('/applications', { intent: 'auto', method: 'POST', json: { a: 1 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://tracker.example.com/api/applications');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'X-JT-Intent': 'auto', 'Content-Type': 'application/json' });
  });

  it('refuses to call the API when not paired', async () => {
    await expect(apiFetch('/auth/me', { intent: 'user' })).rejects.toMatchObject({ status: 401, code: 'not_paired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns API errors into ApiError with the server message', async () => {
    store.token = TOKEN;
    fetchMock.mockResolvedValue(json(403, { error: { code: 'forbidden', message: 'This endpoint does not accept automatic signals' } }));
    await expect(apiFetch('/x', { intent: 'auto' })).rejects.toMatchObject({ status: 403, message: 'This endpoint does not accept automatic signals' });
  });
});

describe('pairing', () => {
  it('rejects text that is not a pairing code without calling the API', async () => {
    await expect(connect('hello')).rejects.toMatchObject({ code: 'bad_code' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.token).toBeUndefined();
  });

  it('stores the token and account only after the API accepts it', async () => {
    fetchMock.mockResolvedValue(json(200, { user: { email: 'asha@example.com', name: 'Asha' } }));
    const account = await connect(`  ${TOKEN}\n`);
    expect(account).toEqual({ email: 'asha@example.com', name: 'Asha' });
    expect(store).toMatchObject({ token: TOKEN, account });
    expect(fetchMock.mock.calls[0]![1].headers['X-JT-Intent']).toBe('user');
  });

  it('a revoked/invalid code leaves nothing stored', async () => {
    fetchMock.mockResolvedValue(json(401, { error: { code: 'unauthorized', message: 'Invalid or revoked API token' } }));
    await expect(connect(TOKEN)).rejects.toMatchObject({ code: 'bad_code' });
    expect(store.token).toBeUndefined();
  });

  it('extension switched off on the server: the server’s message is shown, nothing stored', async () => {
    fetchMock.mockResolvedValue(json(403, { error: { code: 'feature_disabled', message: 'Browser extension is switched off in Settings.' } }));
    await expect(connect(TOKEN)).rejects.toMatchObject({ status: 403, code: 'feature_disabled', message: 'Browser extension is switched off in Settings.' });
    expect(store.token).toBeUndefined();
  });

  it('disconnect revokes on the server and forgets the token', async () => {
    store.token = TOKEN;
    store.account = { email: 'a@b.c', name: null };
    fetchMock.mockResolvedValue(json(204, null));
    expect(await disconnect()).toEqual({ revokedOnServer: true });
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/api\/auth\/tokens\/self\/revoke$/);
    expect(store.token).toBeUndefined();
  });

  it('disconnect still forgets the token when offline, and says it must be revoked in Settings', async () => {
    store.token = TOKEN;
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await disconnect()).toEqual({ revokedOnServer: false });
    expect(store.token).toBeUndefined();
  });
});
