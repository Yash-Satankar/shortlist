import type { ApplicationStatus, EventSource } from './enums';

/**
 * Status-change rules. Manual changes always win. Automatic sources (extension
 * page detection, portal sync, email, system jobs) are constrained so a stale or
 * misread signal can never silently undo real progress.
 */

/** What happened to a proposed change; stored on the timeline event. */
export const EVENT_DISPOSITIONS = ['applied', 'ignored', 'pending_review', 'dismissed'] as const;
export type EventDisposition = (typeof EVENT_DISPOSITIONS)[number];

/**
 * Sources that represent a deliberate user action rather than machine inference.
 * 'extension' = the user clicked something in the extension (popup status change,
 * one-click save, edit). Auto-detection from the extension is 'extension_auto'.
 */
export const USER_SOURCES: ReadonlySet<EventSource> = new Set(['manual', 'import', 'share', 'extension']);
export const isAutomaticSource = (source: EventSource) => !USER_SOURCES.has(source);

/**
 * How sure an automatic source is about its reading. Portal adapters reading an
 * explicit status label, or an email classified with high confidence, send 'high'.
 * Anything unspecified is treated as 'low'.
 */
export const SIGNAL_CONFIDENCES = ['high', 'low'] as const;
export type SignalConfidence = (typeof SIGNAL_CONFIDENCES)[number];

/** Forward pipeline order. Outcomes (offer/rejected/...) sit outside it. */
export const PIPELINE_RANK: Partial<Record<ApplicationStatus, number>> = {
  saved: 0,
  applied: 1,
  viewed: 2,
  assessment: 3,
  shortlisted: 4,
  interview: 5,
};

/** Final states: automatic sources may never move an application OUT of these, only flag it. */
export const LOCKED_STATUSES: ReadonlySet<ApplicationStatus> = new Set(['offer', 'rejected', 'withdrawn']);

/** Only the user decides these; an automatic signal for them is flagged for review. */
const USER_ONLY_TARGETS: ReadonlySet<ApplicationStatus> = new Set(['ghosted', 'withdrawn']);

export interface StatusDecision {
  disposition: Exclude<EventDisposition, 'dismissed'>;
  reason:
    | 'user_action'
    | 'no_change'
    | 'forward'
    | 'rejection'
    | 'revived'
    | 'backwards'
    | 'locked'
    | 'user_only_target'
    | 'offer_needs_review'
    | 'low_confidence';
}

export function decideStatusChange(input: {
  current: ApplicationStatus;
  proposed: ApplicationStatus;
  source: EventSource;
  confidence?: SignalConfidence;
}): StatusDecision {
  const { current, proposed, source } = input;
  const confidence = input.confidence ?? 'low';

  if (current === proposed) return { disposition: 'ignored', reason: 'no_change' };
  if (!isAutomaticSource(source)) return { disposition: 'applied', reason: 'user_action' };

  // Leaving a final state automatically: always a human decision.
  if (LOCKED_STATUSES.has(current)) return { disposition: 'pending_review', reason: 'locked' };
  if (USER_ONLY_TARGETS.has(proposed)) return { disposition: 'pending_review', reason: 'user_only_target' };

  // Into Offer: always reviewed. Fake "offers" are the most common job scam.
  if (proposed === 'offer') return { disposition: 'pending_review', reason: 'offer_needs_review' };

  // Into Rejected: applied when the signal is unambiguous (still on the timeline and undoable).
  if (proposed === 'rejected') {
    return confidence === 'high'
      ? { disposition: 'applied', reason: 'rejection' }
      : { disposition: 'pending_review', reason: 'low_confidence' };
  }

  const proposedRank = PIPELINE_RANK[proposed]!;
  if (current === 'ghosted') {
    // Any sign of life after "ghosted" (viewed or beyond) reopens it; a late confirmation doesn't.
    if (proposedRank < PIPELINE_RANK.viewed!) return { disposition: 'ignored', reason: 'backwards' };
    return confidence === 'high' ? { disposition: 'applied', reason: 'revived' } : { disposition: 'pending_review', reason: 'low_confidence' };
  }

  if (proposedRank <= PIPELINE_RANK[current]!) return { disposition: 'ignored', reason: 'backwards' };
  // Forward moves apply on their own only when the signal is sure; a false "Applied" is worse
  // than asking (e.g. a submission detected by an adapter not yet verified on real pages).
  return confidence === 'high' ? { disposition: 'applied', reason: 'forward' } : { disposition: 'pending_review', reason: 'low_confidence' };
}

/** Statuses that count as "waiting on the employer" for follow-up / ghost suggestions. */
export const AWAITING_RESPONSE_STATUSES: readonly ApplicationStatus[] = ['applied', 'viewed'];
export const OPEN_STATUSES: readonly ApplicationStatus[] = ['applied', 'viewed', 'assessment', 'shortlisted', 'interview'];

export const FOLLOW_UP_REASONS = ['due', 'no_response', 'post_interview'] as const;
export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number];
export const FOLLOW_UP_REASON_LABELS: Record<FollowUpReason, string> = {
  due: 'Follow-up date reached',
  no_response: 'No response yet',
  post_interview: 'Post-interview check-in',
};

/**
 * Numeric signal confidence (0–1) is what gets stored; the rules above still reason in
 * high/low, derived with a threshold (CONFIDENCE_HIGH_THRESHOLD on the server, default 0.8).
 */
export const DEFAULT_CONFIDENCE_HIGH_THRESHOLD = 0.8;
/** Score assumed for an automatic signal that didn't say how sure it was (the old "low"). */
export const UNSPECIFIED_CONFIDENCE_SCORE = 0.5;
/** Legacy high/low values as scores (used by the migration and for clients that still send words). */
export const LEGACY_CONFIDENCE_SCORE: Record<SignalConfidence, number> = { high: 0.9, low: 0.5 };

export function confidenceLevel(score: number, threshold = DEFAULT_CONFIDENCE_HIGH_THRESHOLD): SignalConfidence {
  return score >= threshold ? 'high' : 'low';
}
