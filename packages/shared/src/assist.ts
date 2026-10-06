import { z } from 'zod';

/**
 * AI-written help: interview prep packs and follow-up drafts. The API validates the model's
 * output against these schemas (too long or malformed → refused, not stored); the web app
 * renders the same types. Lengths are generous caps, not targets.
 */

const line = (max: number) => z.string().trim().min(1).max(max);

export const prepPackSchema = z.object({
  /** The role in two or three sentences. */
  summary: line(1200),
  strengths: z.array(z.object({ point: line(300), evidence: line(400) })).max(8).default([]),
  gaps: z.array(z.object({ gap: line(300), howToAddress: line(500) })).max(8).default([]),
  likelyQuestions: z.array(z.object({ question: line(300), why: line(300), answerHints: z.array(line(300)).max(5).default([]) })).min(1).max(12),
  talkingPoints: z.array(line(400)).max(10).default([]),
  questionsToAsk: z.array(line(300)).max(8).default([]),
});
export type PrepPack = z.infer<typeof prepPackSchema>;

/** Why a stored pack may no longer match its inputs. */
export const PREP_OUTDATED_REASONS = ['jd', 'resume', 'answers'] as const;
export type PrepOutdatedReason = (typeof PREP_OUTDATED_REASONS)[number];

export const PREP_OUTDATED_LABELS: Record<PrepOutdatedReason, string> = {
  jd: 'job description',
  resume: 'resume',
  answers: 'answer library',
};

/** Follow-up drafts: an email, a LinkedIn connection note (hard character limit) or a LinkedIn message. */
export const DRAFT_CHANNELS = ['email', 'linkedin_note', 'linkedin_message'] as const;
export type DraftChannel = (typeof DRAFT_CHANNELS)[number];

export const DRAFT_CHANNEL_LABELS: Record<DraftChannel, string> = {
  email: 'Email',
  linkedin_note: 'LinkedIn note',
  linkedin_message: 'LinkedIn message',
};

export const DRAFT_PURPOSES = ['no_response', 'post_interview', 'due', 'general'] as const;
export type DraftPurpose = (typeof DRAFT_PURPOSES)[number];

export const draftRequestSchema = z.object({
  applicationId: z.uuid(),
  channel: z.enum(DRAFT_CHANNELS),
  purpose: z.enum(DRAFT_PURPOSES).default('general'),
  /** Optional steer from the user ("mention I'm free next week"). */
  instructions: z.string().trim().max(500).optional(),
});
export type DraftRequest = z.infer<typeof draftRequestSchema>;

export interface Draft {
  channel: DraftChannel;
  /** Email only. */
  subject: string | null;
  body: string;
  /** Characters allowed for this channel (the LinkedIn note's hard limit), or null. */
  maxChars: number | null;
  /** The application's contact with an email address (email drafts), for the mailto link. */
  to: string | null;
}
