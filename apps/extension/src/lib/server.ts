import { DEFAULT_API_ORIGIN, hasChrome, writeState } from './config';

/**
 * Self-hosted trackers: the extension talks to the hosted default unless you point it at your
 * own server. Chrome asks you to allow that one origin (an optional permission), and the
 * server must answer /api/health before it's saved. Change it only while not paired.
 */

/** "tracker.example.com" → "https://tracker.example.com". https only, except a local server. */
export function normalizeServerUrl(input: string): string {
  let raw = input.trim();
  if (!raw) throw new Error('Enter your tracker’s address');
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That isn’t a valid address');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Use an https:// address (http only for localhost)');
  if (url.username || url.password) throw new Error('Leave the user name and password out of the address');
  return url.origin;
}

export const isDefaultServer = (origin: string) => origin === new URL(DEFAULT_API_ORIGIN).origin;

/** Asks Chrome for the origin (must run from a click), checks the server, then saves it. */
export async function switchServer(input: string, fetcher: typeof fetch = fetch): Promise<string> {
  const origin = normalizeServerUrl(input);
  if (hasChrome() && !isDefaultServer(origin)) {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error('Chrome needs your permission to reach that server');
  }
  let ok = false;
  try {
    const res = await fetcher(`${origin}/api/health`, { credentials: 'omit' });
    ok = res.ok && ((await res.json().catch(() => null)) as { ok?: boolean } | null)?.ok === true;
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('No Job Tracker answered at that address');
  await writeState({ apiOrigin: isDefaultServer(origin) ? undefined : origin });
  if (hasChrome() && isDefaultServer(origin)) await chrome.storage.local.remove('apiOrigin');
  return origin;
}
