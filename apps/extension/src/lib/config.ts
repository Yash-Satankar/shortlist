/**
 * Where the extension talks to. Public builds have no default: you enter your ShortList's address
 * in the popup (Chrome asks to allow it). A build can bake one in with VITE_API_ORIGIN; dev builds
 * point at localhost.
 */
export const DEFAULT_API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN || '';
export const EXTENSION_VERSION: string = import.meta.env.VITE_EXTENSION_VERSION ?? '0.0.0';

/** True only inside a real extension page (the popup can also be previewed as a plain page). */
export const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.storage?.local;

export interface Account {
  email: string;
  name: string | null;
}

export interface StoredState {
  apiOrigin?: string;
  /** API token from pairing. Lives only in chrome.storage.local (this browser profile). */
  token?: string;
  account?: Account;
}

export async function readState(): Promise<StoredState> {
  if (!hasChrome()) return {};
  return (await chrome.storage.local.get(['apiOrigin', 'token', 'account'])) as StoredState;
}

export async function writeState(patch: Partial<StoredState>): Promise<void> {
  if (hasChrome()) await chrome.storage.local.set(patch);
}

export async function clearConnection(): Promise<void> {
  if (hasChrome()) await chrome.storage.local.remove(['token', 'account']);
}

export async function apiOrigin(): Promise<string> {
  return (await readState()).apiOrigin ?? DEFAULT_API_ORIGIN;
}
