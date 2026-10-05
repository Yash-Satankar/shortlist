import { canonicalJobUrl, WORK_MODES } from '@jt/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { statusEvents } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { badRequest } from '../lib/http';
import { createApplication, findDuplicateMatches } from './service';
import { proposeStatus } from './status';

/**
 * The extension saw a platform's own "application submitted" confirmation on a page you have
 * switched on. Verified detectors (tested on real captures) propose Applied with high
 * confidence, so the normal rules apply it (undoable); unverified ones with low confidence,
 * so it waits in Follow-ups for you to confirm. Recording is idempotent per job.
 */
export const detectedSubmissionSchema = z.object({
  site: z.enum(['linkedin', 'naukri', 'greenhouse', 'lever', 'workday']),
  jobUrl: z.url({ protocol: /^https?$/ }).max(2000),
  /** Which confirmation signal matched (for the timeline note), e.g. "post-apply modal". */
  signal: z.string().trim().min(1).max(100),
  verified: z.boolean(),
  roleTitle: z.string().trim().max(300).optional(),
  companyName: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  jd: z.string().trim().max(100_000).optional(),
});
export type DetectedSubmission = z.infer<typeof detectedSubmissionSchema>;

export const SUBMITTED_EVIDENCE = 'submitted_page';

/** Stable id for "this user submitted this job" (same job → same id → no second event). */
function evidenceId(userId: string, canonical: string): string {
  const h = sha256(`${userId}|submitted|${canonical}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface DetectedResult {
  applicationId: string | null;
  /** True when this signal created the application (Undo then removes it). */
  created: boolean;
  matchedBy: 'url' | 'company_role' | null;
  /** Already recorded earlier (reload / revisit): nothing new happened. */
  duplicate: boolean;
  event: { id: string; disposition: string; reason: string | null } | null;
  /** Not tracked yet and the page didn't show role + company: the popup can save it. */
  needsDetails: boolean;
}

export async function recordDetectedSubmission(db: Db, userId: string, input: DetectedSubmission): Promise<DetectedResult> {
  const canonical = canonicalJobUrl(input.jobUrl);
  if (!canonical) throw badRequest('Not a job URL');
  const e = env();
  const evidence = { type: SUBMITTED_EVIDENCE, id: evidenceId(userId, canonical.canonical) };
  const verifiedScore = input.verified ? e.DETECTION_VERIFIED_CONFIDENCE : e.DETECTION_UNVERIFIED_CONFIDENCE;
  const note = `Submitted page detected on ${input.site} (${input.signal}${input.verified ? '' : ', detector not yet verified'})`;

  const matches = await findDuplicateMatches(db, userId, { jobUrl: input.jobUrl, companyName: input.companyName ?? '', roleTitle: input.roleTitle ?? '' });
  const exact = matches.find((m) => m.level === 'exact');
  const likely = matches.filter((m) => m.level === 'likely');

  let applicationId: string;
  let created = false;
  let matchedBy: DetectedResult['matchedBy'] = null;
  let score = verifiedScore;

  if (exact) {
    applicationId = exact.id;
    matchedBy = 'url';
  } else if (likely.length === 1) {
    // Same company + role under another link (e.g. saved from LinkedIn, applied on Greenhouse):
    // probably the same job, but not certain, so it always asks.
    applicationId = likely[0]!.id;
    matchedBy = 'company_role';
    score = Math.min(score, e.DETECTION_UNVERIFIED_CONFIDENCE);
  } else if (likely.length > 1 || !input.roleTitle || !input.companyName) {
    return { applicationId: null, created: false, matchedBy: null, duplicate: false, event: null, needsDetails: likely.length === 0 };
  } else {
    // Not tracked yet: save it (as Saved), then propose Applied below like any other signal.
    const res = await createApplication(
      db,
      userId,
      {
        companyName: input.companyName,
        roleTitle: input.roleTitle,
        location: input.location ?? null,
        workMode: input.workMode,
        jobUrl: input.jobUrl,
        jd: input.jd,
        status: 'saved',
        via: 'manual',
        confirmDuplicate: false,
      } as Parameters<typeof createApplication>[2],
      'extension_auto',
    );
    applicationId = res.application.id;
    created = true;
  }

  // Idempotent: this job's submission was already recorded (reload, revisit, second tab).
  const [prior] = await db
    .select({ id: statusEvents.id, disposition: statusEvents.disposition, reason: statusEvents.reason })
    .from(statusEvents)
    .where(and(eq(statusEvents.userId, userId), eq(statusEvents.applicationId, applicationId), eq(statusEvents.evidenceType, evidence.type), eq(statusEvents.evidenceId, evidence.id)))
    .limit(1);
  if (prior) return { applicationId, created: false, matchedBy, duplicate: true, event: prior, needsDetails: false };

  const { event } = await proposeStatus(db, { userId, applicationId, status: 'applied', source: 'extension_auto', confidence: score, evidence, note });
  return {
    applicationId,
    created,
    matchedBy,
    duplicate: false,
    event: event ? { id: event.id, disposition: event.disposition, reason: event.reason } : null,
    needsDetails: false,
  };
}
