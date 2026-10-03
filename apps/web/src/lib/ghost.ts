import { api } from '../api/client';
import { keys } from '../api/hooks';
import { queryClient } from '../api/queryClient';
import type { FollowUps } from '../api/types';

/**
 * "Not yet" on a ghost suggestion. Stored on the server per application
 * (POST /applications/:id/ghost/dismiss), so it holds on every device; the server stops
 * suggesting it until there's new activity or GHOST_SUGGEST_DAYS pass.
 */

// One-time cleanup of the old device-local list.
try {
  localStorage.removeItem('jt-ghost-not-yet');
} catch {
  // storage unavailable: nothing to clean
}

export function dismissGhost(item: { id: string }) {
  // Hide it immediately, as before; the server is the source of truth from here on.
  const previous = queryClient.getQueryData<FollowUps>(keys.followUps);
  if (previous) {
    queryClient.setQueryData<FollowUps>(keys.followUps, {
      ...previous,
      ghostSuggestions: previous.ghostSuggestions.filter((g) => g.id !== item.id),
    });
  }
  api(`/applications/${item.id}/ghost/dismiss`, { method: 'POST' })
    .catch(() => {
      if (previous) queryClient.setQueryData(keys.followUps, previous);
    })
    .finally(() => {
      void queryClient.invalidateQueries({ queryKey: keys.followUps });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    });
}

/** The server already leaves dismissed suggestions out; kept so callers stay unchanged. */
export function useVisibleGhosts<T>(items: T[] | undefined): T[] {
  return items ?? [];
}
