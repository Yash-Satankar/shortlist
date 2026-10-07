import { and, asc, eq, isNull } from 'drizzle-orm';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { emails, statusEvents } from '../db/schema';
import { createApplication, findDuplicateMatches } from '../applications/service';
import { HttpError } from '../lib/http';
import { isAtsDomain, type Classification, type EmailCategory } from './classify';
import { extractJob, PORTAL_LABEL, PORTAL_SOURCE, type ExtractedJob } from './extract';
import { emailConfidence, matchApplication, proposeFromEmail, type IngestResult } from './ingest';
import { extractLinks, type RawEmail } from './sources';

/**
 * Emails that match nothing you track.
 *
 * A **confirmation** ("your application was sent to…", "we received your application…") from
 * a known job portal or ATS, classified by the rules, whose company and role were read with
 * confidence, creates the application: as Saved ("created from email"), then Applied through
 * the normal status rules (so it's undoable), dated by the email. The normal duplicate check
 * runs first: the same job link means it's an application you already have; the same company
 * and role means it might be, so you decide. The job's canonical link and id are stored, so a
 * later save from the extension or by hand matches it instead of creating a second one.
 *
 * Anything else (interview, assessment, rejection, viewed, offers, unknown senders, unsure
 * extraction) stays in "Emails to match", pre-filled for "Create new application".
 */

/** A stored email back in the shape the pipeline reads (subject, sender, excerpt; links from the excerpt). */
export function storedToRaw(row: { messageId: string; fromEnc: string; subjectEnc: string; excerptEnc: string | null; receivedAt: Date }): RawEmail {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(row.fromEnc);
  const text = row.excerptEnc ?? '';
  return {
    messageId: row.messageId,
    from: m ? { name: m[1] || null, address: m[2]!.toLowerCase() } : { name: null, address: row.fromEnc.trim().toLowerCase() },
    subject: row.subjectEnc,
    date: row.receivedAt,
    text,
    links: extractLinks(text),
  };
}

const createdNote = (x: ExtractedJob) => `Created from a ${x.portal ? PORTAL_LABEL[x.portal] : 'confirmation'} email · job description not captured`;

/** Auto-creates the application for a confident confirmation email; null when it shouldn't. */
export async function createFromConfirmation(db: Db, userId: string, emailId: string, raw: RawEmail, c: Classification, by: 'rules' | 'ai', fromDomain: string): Promise<(IngestResult & { created: boolean }) | null> {
  const e = env();
  if (!e.EMAIL_AUTOCREATE_FROM_CONFIRMATIONS) return null;
  // Only the portal's own "application received/sent" notice, read by the rules. Offers, interviews,
  // rejections, unknown senders and AI-classified emails never create applications on their own.
  if (c.category !== 'received' || by !== 'rules' || !c.fromAts) return null;
  const x = extractJob(raw);
  if (!x.portal || !x.companyName || !x.roleTitle || x.confidence < e.EMAIL_AUTOCREATE_MIN_EXTRACTION) return null;

  const dups = await findDuplicateMatches(db, userId, { companyName: x.companyName, roleTitle: x.roleTitle, jobUrl: x.jobUrl });
  const exact = dups.find((d) => d.level === 'exact');
  if (exact) {
    await db.update(emails).set({ applicationId: exact.id, matchedBy: 'url' }).where(eq(emails.id, emailId));
    return { ...(await proposeFromEmail(db, userId, emailId, exact.id, c, emailConfidence(c, by, 'url'), raw.date, fromDomain)), created: false };
  }
  if (dups.some((d) => d.level === 'likely')) return null; // might be one you have: you decide

  let applicationId: string;
  try {
    const { application } = await createApplication(
      db,
      userId,
      { companyName: x.companyName, roleTitle: x.roleTitle, location: x.location, jobUrl: x.jobUrl, status: 'saved', source: PORTAL_SOURCE[x.portal], sourceDetail: `${PORTAL_LABEL[x.portal]} (confirmation email)`, via: 'manual', confirmDuplicate: false },
      'email',
    );
    applicationId = application.id;
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return null; // lost a race with another save of the same job
    throw err;
  }
  // The "created" step sits just before the applied date on the timeline, with the email as evidence.
  await db
    .update(statusEvents)
    .set({ note: createdNote(x), evidenceType: 'email', evidenceId: emailId, occurredAt: new Date(raw.date.getTime() - 60_000), confidenceScore: x.confidence })
    .where(and(eq(statusEvents.applicationId, applicationId), isNull(statusEvents.fromStatus)));
  await db.update(emails).set({ applicationId, matchedBy: 'created' }).where(eq(emails.id, emailId));
  return { ...(await proposeFromEmail(db, userId, emailId, applicationId, c, c.confidence, raw.date, fromDomain)), created: true };
}

/** For the "Create new application" form: what the email says (any field may be missing). */
export function suggestionFor(row: Parameters<typeof storedToRaw>[0]) {
  const x = extractJob(storedToRaw(row));
  return { companyName: x.companyName, roleTitle: x.roleTitle, location: x.location, jobUrl: x.jobUrl, appliedOn: row.receivedAt.toISOString().slice(0, 10), portal: x.portal ? PORTAL_LABEL[x.portal] : null };
}

/** You chose "Create new application" on an unmatched email (pre-filled, edited by you). */
export async function createFromUnmatched(db: Db, userId: string, emailId: string, input: { companyName: string; roleTitle: string; location?: string | null; jobUrl?: string | null; confirmDuplicate?: boolean }): Promise<IngestResult> {
  const [email] = await db.select().from(emails).where(and(eq(emails.id, emailId), eq(emails.userId, userId), eq(emails.outcome, 'unmatched')));
  if (!email) throw new HttpError(404, 'Email not found', 'not_found');
  const portal = extractJob(storedToRaw(email)).portal;
  const { application } = await createApplication(
    db,
    userId,
    { ...input, status: 'saved', source: portal ? PORTAL_SOURCE[portal] : undefined, sourceDetail: portal ? `${PORTAL_LABEL[portal]} (from an email)` : 'From an email', via: 'manual', confirmDuplicate: input.confirmDuplicate ?? false },
    'manual',
  );
  await db
    .update(statusEvents)
    .set({ note: 'Created from an email', evidenceType: 'email', evidenceId: emailId, occurredAt: new Date(email.receivedAt.getTime() - 60_000) })
    .where(and(eq(statusEvents.applicationId, application.id), isNull(statusEvents.fromStatus)));
  await db.update(emails).set({ applicationId: application.id, matchedBy: 'created' }).where(eq(emails.id, emailId));
  // You made the match: the classification's own confidence applies (as with "Choose existing").
  return proposeFromEmail(db, userId, emailId, application.id, { category: email.category as EmailCategory }, email.confidence, email.receivedAt, email.fromDomain);
}

/**
 * Re-runs stored unmatched emails through today's logic: match again (you may have added the
 * application since), else create from a confident confirmation. Used once by a data migration
 * after this logic shipped. Returns counts only.
 */
export async function reprocessUnmatched(db: Db): Promise<{ checked: number; matched: number; created: number; stillUnmatched: number }> {
  const rows = await db.select().from(emails).where(eq(emails.outcome, 'unmatched')).orderBy(asc(emails.receivedAt));
  let matched = 0;
  let created = 0;
  for (const row of rows) {
    const raw = storedToRaw(row);
    const c: Classification = { category: row.category as EmailCategory, confidence: row.confidence, rule: null, fromAts: isAtsDomain(row.fromDomain) };
    const by = row.classifiedBy === 'ai' ? 'ai' : 'rules';
    const m = await matchApplication(db, row.userId, raw);
    if (m) {
      await db.update(emails).set({ applicationId: m.applicationId, matchedBy: m.by }).where(eq(emails.id, row.id));
      await proposeFromEmail(db, row.userId, row.id, m.applicationId, c, emailConfidence(c, by, m.by), row.receivedAt, row.fromDomain);
      matched++;
      continue;
    }
    const r = await createFromConfirmation(db, row.userId, row.id, raw, c, by, row.fromDomain);
    if (r?.created) created++;
    else if (r) matched++;
  }
  const still = await db.select({ id: emails.id }).from(emails).where(eq(emails.outcome, 'unmatched'));
  return { checked: rows.length, matched, created, stillUnmatched: still.length };
}
