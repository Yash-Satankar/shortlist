import { autoReadScriptId, SITES, siteById, type SiteId } from './sites';

/**
 * Per-site reading. Chrome's own host permission is the single on/off state: a site is
 * "on" exactly when every one of its origins is granted (so the switch can never disagree
 * with chrome://extensions). Turning a site off gives the permission back.
 */
export type SiteStates = Record<SiteId, boolean>;

export async function siteStates(): Promise<SiteStates> {
  const entries = await Promise.all(SITES.map(async (s) => [s.id, await chrome.permissions.contains({ origins: s.origins })] as const));
  return Object.fromEntries(entries) as SiteStates;
}

/** Must be the first await inside a click handler: Chrome only shows its prompt for a user gesture. */
export function enableSite(id: SiteId): Promise<boolean> {
  return chrome.permissions.request({ origins: siteById(id).origins });
}

export function disableSite(id: SiteId): Promise<boolean> {
  return chrome.permissions.remove({ origins: siteById(id).origins });
}

export const AUTO_READ_FILES = ['content/reader.js', 'content/auto.js'];

let queue: Promise<unknown> = Promise.resolve();

/**
 * Makes the registered auto-read content scripts match the granted sites: registers the
 * missing ones, unregisters the rest. Serialised, so overlapping permission events can't race.
 */
export function syncContentScripts(): Promise<{ registered: SiteId[]; unregistered: SiteId[] }> {
  const run = async () => {
    const states = await siteStates();
    const existing = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
    const registered: SiteId[] = [];
    const unregistered: SiteId[] = [];
    const toRemove: string[] = [];
    for (const site of SITES) {
      const id = autoReadScriptId(site.id);
      if (states[site.id] && !existing.has(id)) registered.push(site.id);
      if (!states[site.id] && existing.has(id)) {
        unregistered.push(site.id);
        toRemove.push(id);
      }
    }
    if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
    if (registered.length) {
      await chrome.scripting.registerContentScripts(
        registered.map((sid) => ({
          id: autoReadScriptId(sid),
          matches: siteById(sid).origins,
          js: AUTO_READ_FILES,
          runAt: 'document_idle' as const,
          persistAcrossSessions: true,
        })),
      );
    }
    return { registered, unregistered };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
