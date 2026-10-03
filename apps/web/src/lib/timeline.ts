import type { TimelineEvent } from '../api/types';

/**
 * The change "Undo" would revert, mirroring the API rule: only the newest applied,
 * not-yet-reverted event, and only if it has a previous status (not the creation event).
 */
export function latestEffective(timeline: TimelineEvent[]): TimelineEvent | undefined {
  const effective = timeline
    .filter((e) => e.disposition === 'applied' && !e.revertedAt)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.occurredAt.localeCompare(a.occurredAt));
  const latest = effective[0];
  return latest?.fromStatus ? latest : undefined;
}
