import type { ApplicationStatus, EventSource } from './enums';

/**
 * Status-change rules. Manual changes always win. Automatic sources (extension
 * page detection, portal sync, email, system jobs) are constrained so a stale or
 * misread signal can never silently undo real progress.
 */

/** What happened to a proposed change; stored on the timeline event. */
export const EVENT_DISPOSITIONS = ['applied', 'ignored', 'pending_review', 'dismissed'] as const;
export type EventDisposition = (typeof EVENT_DISPOSITIONS)[number];

/** Sources that represent a deliberate user action rather than machine inference. */
export const USER_SOURCES: ReadonlySet<EventSource> = new Set(['manual', 'import', 'share']);
export const isAutomaticSource = (source: EventSource) => !USER_SOURCES.has(source);

/** Forward pipeline order. Outcomes (offer/rejected/...) sit outside it. */
export const PIPELINE_RANK: Partial<Record<ApplicationStatus, number>> = {
  saved: 0,
  applied: 1,
  viewed: 2,
  assessment: 3,
  shortlisted: 4,
  interview: 5,
};

/** Final outcomes: automatic sources may never change these, only flag them. */
export const LOCKED_STATUSES: ReadonlySet<ApplicationStatus> = new Set(['offer', 'rejected', 'withdrawn']);

/** Only the user decides these; an automatic signal for them is flagged for review. */
const USER_ONLY_TARGETS: ReadonlySet<ApplicationStatus> = new Set(['ghosted', 'withdrawn']);

export interface StatusDecision {
  disposition: Exclude<EventDisposition, 'dismissed'>;
  reason:
    | 'user_action'
    | 'no_change'
    | 'forward'
    | 'outcome'
    | 'revived'
    | 'backwards'
    | 'locked'
    | 'user_only_target';
}

export function decideStatusChange(input: {
  current: ApplicationStatus;
  proposed: ApplicationStatus;
  source: EventSource;
}): StatusDecision {
  const { current, proposed, source } = input;

  if (current === proposed) return { disposition: 'ignored', reason: 'no_change' };
  if (!isAutomaticSource(source)) return { disposition: 'applied', reason: 'user_action' };

  if (LOCKED_STATUSES.has(current)) return { disposition: 'pending_review', reason: 'locked' };
  if (USER_ONLY_TARGETS.has(proposed)) return { disposition: 'pending_review', reason: 'user_only_target' };

  // Offer / rejection signals are real outcomes from any open state.
  if (proposed === 'offer' || proposed === 'rejected') return { disposition: 'applied', reason: 'outcome' };

  const proposedRank = PIPELINE_RANK[proposed]!;
  if (current === 'ghosted') {
    // Any sign of life after "ghosted" (viewed or beyond) reopens it; a late confirmation doesn't.
    return proposedRank >= PIPELINE_RANK.viewed!
      ? { disposition: 'applied', reason: 'revived' }
      : { disposition: 'ignored', reason: 'backwards' };
  }

  return proposedRank > PIPELINE_RANK[current]!
    ? { disposition: 'applied', reason: 'forward' }
    : { disposition: 'ignored', reason: 'backwards' };
}

/** Statuses that count as "waiting on the employer" for follow-up / ghost suggestions. */
export const AWAITING_RESPONSE_STATUSES: readonly ApplicationStatus[] = ['applied', 'viewed'];
export const OPEN_STATUSES: readonly ApplicationStatus[] = ['applied', 'viewed', 'assessment', 'shortlisted', 'interview'];
