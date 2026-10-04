/** Where the extension talks to. Production by default; dev builds point at localhost. */
export const DEFAULT_API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN ?? 'https://your-shortlist.example.com';
export const EXTENSION_VERSION: string = import.meta.env.VITE_EXTENSION_VERSION ?? '0.0.0';

/** True only inside a real extension page (the popup can also be previewed as a plain page). */
export const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;

export interface StoredState {
  apiOrigin?: string;
  token?: string;
  account?: { email: string; name: string | null };
}

export async function readState(): Promise<StoredState> {
  if (!hasChrome) return {};
  return (await chrome.storage.local.get(['apiOrigin', 'token', 'account'])) as StoredState;
}

export async function apiOrigin(): Promise<string> {
  return (await readState()).apiOrigin ?? DEFAULT_API_ORIGIN;
}
