import { useSyncExternalStore } from 'react';

/**
 * "Not yet" on a ghost suggestion. The API has no dismissal for suggestions (they are
 * derived from last activity), so this is remembered on this device only, and only
 * until the application has new activity: the key includes lastActivityAt.
 */
const KEY = 'jt-ghost-not-yet';
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let snapshot = read();

const ghostKey = (item: { id: string; lastActivityAt: string }) => `${item.id}@${item.lastActivityAt}`;

export function dismissGhost(item: { id: string; lastActivityAt: string }) {
  snapshot = [...snapshot.filter((k) => !k.startsWith(`${item.id}@`)), ghostKey(item)].slice(-200);
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode: dismissal lasts for this session only.
  }
  listeners.forEach((l) => l());
}

/** Filters out suggestions the user said "Not yet" to (until their activity changes). */
export function useVisibleGhosts<T extends { id: string; lastActivityAt: string }>(items: T[] | undefined): T[] {
  const dismissed = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => snapshot,
  );
  return (items ?? []).filter((i) => !dismissed.includes(ghostKey(i)));
}
