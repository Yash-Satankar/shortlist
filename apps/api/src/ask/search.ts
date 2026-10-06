import { normalizeCompanyName } from '@jt/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { env } from '../config/env';
import type { DbOrTx } from '../db/client';
import { applicationAnswers, applications, companies, emails, jobDescriptions, statusEvents } from '../db/schema';

/**
 * Finds what one user's own data says about a question, for "Ask my job search".
 *
 * Plain fields (applications, notes, JDs, screening answers, timeline notes) are searched with
 * Postgres full-text search. Stored emails are encrypted, so they can't be indexed: when the
 * user allows it, the newest ASK_MAX_EMAILS_SCANNED are decrypted in memory for this request,
 * scored here, and dropped. Nothing decrypted is written anywhere. No embeddings (a stored
 * embedding would be a readable copy of encrypted text). Everything is filtered by user_id.
 */

export type SourceType = 'application' | 'jd' | 'answer' | 'event' | 'email';

export interface Source {
  /** "S1", "S2"… — what the model cites. */
  ref: string;
  type: SourceType;
  id: string;
  applicationId: string | null;
  /** "Acme · Backend Engineer", or the email's subject. */
  label: string;
  date: string | null;
  text: string;
  score: number;
}

const STOP = new Set(
  'a an and are as at be but by did do does for from had has have how i in is it its me my of on or our so than that the their them then there these they this to was we were what when where which who whom why will with you your about any all can could would should into over under after before since until just also only not no yes up out get got been being am ask tell show give much many'.split(
    ' ',
  ),
);

/** Lower-cased words worth searching for (no stop words, no punctuation). */
export function queryTerms(question: string): string[] {
  const words = question.toLowerCase().normalize('NFKD').match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? [];
  return [...new Set(words.map((w) => w.replace(/[.-]+$/, '')).filter((w) => w.length >= 2 && !STOP.has(w)))].slice(0, 24);
}

/** "acme | backend | notice" for to_tsquery (each term sanitized; prefix match for longer words). */
const tsQuery = (terms: string[]) =>
  terms
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((t) => t.length >= 2)
    .map((t) => (t.length >= 4 ? `${t}:*` : t))
    .join(' | ');

/** A window of `max` characters around the first matching term (or the start). */
export function snippet(text: string, terms: string[], max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const lower = clean.toLowerCase();
  const hit = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(hit - Math.floor(max / 3), clean.length - max));
  return `${start > 0 ? '…' : ''}${clean.slice(start, start + max).trim()}${start + max < clean.length ? '…' : ''}`;
}

/** In-memory relevance for decrypted emails: matched terms weighted by rarity (idf), length-damped. */
function scoreDocs(docs: { text: string }[], terms: string[]): number[] {
  if (!terms.length) return docs.map(() => 0);
  const lowered = docs.map((d) => d.text.toLowerCase());
  const df = terms.map((t) => lowered.filter((d) => d.includes(t)).length);
  return lowered.map((d) => {
    let s = 0;
    terms.forEach((t, i) => {
      if (!df[i]) return;
      let count = 0;
      for (let at = d.indexOf(t); at >= 0 && count < 5; at = d.indexOf(t, at + t.length)) count++;
      if (count) s += (1 + Math.log(count)) * Math.log(1 + docs.length / df[i]!);
    });
    return s / Math.sqrt(1 + d.length / 2000);
  });
}

export interface SearchOptions {
  includeEmails: boolean;
}

/** First words too generic to identify a company on their own ("Data Corp" isn't named by "data"). */
const GENERIC_FIRST = new Set('data tech info digital global india soft software systems solutions labs group the new first next smart cloud net web app apps'.split(' '));

/**
 * The user's applications whose company the question names ("what did Tessera say…"): the full
 * normalized name, or its distinctive first word ("Vandelay" for "Vandelay Industries").
 */
async function namedApplications(db: DbOrTx, userId: string, question: string) {
  const rows = await db
    .select({ id: applications.id, company: companies.name, role: applications.roleTitle })
    .from(applications)
    .innerJoin(companies, eq(companies.id, applications.companyId))
    .where(eq(applications.userId, userId));
  const q = ` ${normalizeCompanyName(question)} `;
  return rows.filter((r) => {
    const c = normalizeCompanyName(r.company);
    if (c.length >= 3 && q.includes(` ${c} `)) return true;
    const first = c.split(' ')[0] ?? '';
    return first.length >= 4 && !GENERIC_FIRST.has(first) && q.includes(` ${first} `);
  });
}

export async function searchUserData(db: DbOrTx, userId: string, question: string, opts: SearchOptions): Promise<Source[]> {
  const e = env();
  const terms = queryTerms(question);
  const named = await namedApplications(db, userId, question);
  const namedIds = new Set(named.map((n) => n.id));
  const tq = tsQuery(terms);
  const label = (company: string, role: string) => `${company} · ${role}`;
  const out: Omit<Source, 'ref'>[] = [];
  const NAMED_BOOST = 1;

  if (tq || namedIds.size) {
    const match = (vector: unknown) => (tq ? sql`${vector} @@ to_tsquery('english', ${tq})` : sql`false`);
    const rank = (vector: unknown) => (tq ? sql<number>`ts_rank(${vector}, to_tsquery('english', ${tq}))` : sql<number>`0`);
    const inNamed = (col: unknown) => (namedIds.size ? sql`${col} in (${sql.join([...namedIds].map((id) => sql`${id}::uuid`), sql`, `)})` : sql`false`);

    const apps = await db
      .select({
        id: applications.id,
        company: companies.name,
        role: applications.roleTitle,
        status: applications.status,
        location: applications.location,
        appliedOn: applications.appliedOn,
        notes: applications.notes,
        experienceAsked: applications.experienceAsked,
        salaryListed: applications.salaryListed,
        updated: applications.statusChangedAt,
        rank: rank(applications.search),
      })
      .from(applications)
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(and(eq(applications.userId, userId), sql`(${match(applications.search)} or ${inNamed(applications.id)})`))
      .orderBy(desc(rank(applications.search)))
      .limit(30);
    for (const a of apps) {
      const text = [
        `Status: ${a.status}`,
        a.appliedOn && `Applied: ${a.appliedOn}`,
        a.location && `Location: ${a.location}`,
        a.experienceAsked && `Experience asked: ${a.experienceAsked}`,
        a.salaryListed && `Salary listed: ${a.salaryListed}`,
        a.notes && `Notes: ${a.notes}`,
      ]
        .filter(Boolean)
        .join('. ');
      out.push({ type: 'application', id: a.id, applicationId: a.id, label: label(a.company, a.role), date: a.updated.toISOString(), text, score: a.rank + (namedIds.has(a.id) ? NAMED_BOOST : 0) });
    }

    // Latest JD per application.
    const jds = await db
      .selectDistinctOn([jobDescriptions.applicationId], {
        id: jobDescriptions.id,
        applicationId: jobDescriptions.applicationId,
        content: jobDescriptions.content,
        capturedAt: jobDescriptions.capturedAt,
        company: companies.name,
        role: applications.roleTitle,
        rank: rank(jobDescriptions.search),
        matches: sql<boolean>`${match(jobDescriptions.search)}`,
      })
      .from(jobDescriptions)
      .innerJoin(applications, eq(applications.id, jobDescriptions.applicationId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(and(eq(jobDescriptions.userId, userId), eq(applications.userId, userId), sql`(${match(jobDescriptions.search)} or ${inNamed(jobDescriptions.applicationId)})`))
      .orderBy(jobDescriptions.applicationId, desc(jobDescriptions.capturedAt));
    for (const j of jds) {
      out.push({ type: 'jd', id: j.id, applicationId: j.applicationId, label: label(j.company, j.role), date: j.capturedAt.toISOString(), text: j.content, score: (j.matches ? j.rank : 0) + (namedIds.has(j.applicationId) ? NAMED_BOOST * 0.6 : 0) });
    }

    const answers = await db
      .select({ id: applicationAnswers.id, applicationId: applicationAnswers.applicationId, question: applicationAnswers.question, answer: applicationAnswers.answer, company: companies.name, role: applications.roleTitle, rank: rank(applicationAnswers.search) })
      .from(applicationAnswers)
      .innerJoin(applications, eq(applications.id, applicationAnswers.applicationId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(and(eq(applicationAnswers.userId, userId), eq(applications.userId, userId), match(applicationAnswers.search)))
      .orderBy(desc(rank(applicationAnswers.search)))
      .limit(20);
    for (const a of answers) {
      out.push({ type: 'answer', id: a.id, applicationId: a.applicationId, label: label(a.company, a.role), date: null, text: `Q: ${a.question}\nA: ${a.answer}`, score: a.rank + (namedIds.has(a.applicationId) ? NAMED_BOOST * 0.5 : 0) });
    }

    // Timeline of the applications the question names (status changes with their notes).
    if (namedIds.size) {
      const events = await db
        .select({ id: statusEvents.id, applicationId: statusEvents.applicationId, from: statusEvents.fromStatus, to: statusEvents.toStatus, source: statusEvents.source, note: statusEvents.note, at: statusEvents.occurredAt, company: companies.name, role: applications.roleTitle })
        .from(statusEvents)
        .innerJoin(applications, eq(applications.id, statusEvents.applicationId))
        .innerJoin(companies, eq(companies.id, applications.companyId))
        .where(and(eq(statusEvents.userId, userId), eq(statusEvents.disposition, 'applied'), isNull(statusEvents.revertedAt), inArray(statusEvents.applicationId, [...namedIds])))
        .orderBy(desc(statusEvents.occurredAt))
        .limit(20);
      for (const ev of events) {
        out.push({ type: 'event', id: ev.id, applicationId: ev.applicationId, label: label(ev.company, ev.role), date: ev.at.toISOString(), text: `${ev.from ?? 'new'} → ${ev.to} (${ev.source})${ev.note ? `: ${ev.note}` : ''}`, score: NAMED_BOOST * 0.4 });
      }
    }
  }

  if (opts.includeEmails) {
    // Decrypted here, in memory, for this request only.
    const rows = await db
      .select({ id: emails.id, applicationId: emails.applicationId, from: emails.fromEnc, subject: emails.subjectEnc, excerpt: emails.excerptEnc, receivedAt: emails.receivedAt, category: emails.category })
      .from(emails)
      .where(eq(emails.userId, userId))
      .orderBy(desc(emails.receivedAt))
      .limit(e.ASK_MAX_EMAILS_SCANNED);
    const docs = rows.map((r) => ({ ...r, text: `From: ${r.from}\nSubject: ${r.subject}\n${r.excerpt ?? ''}` }));
    const scores = scoreDocs(docs, terms);
    docs.forEach((d, i) => {
      const s = scores[i]! / 4 + (d.applicationId && namedIds.has(d.applicationId) ? NAMED_BOOST * 0.8 : 0);
      if (s > 0) out.push({ type: 'email', id: d.id, applicationId: d.applicationId, label: d.subject, date: d.receivedAt.toISOString(), text: d.text, score: s });
    });
  }

  return out
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, e.ASK_MAX_SOURCES)
    .map((s, i) => ({ ...s, ref: `S${i + 1}`, text: snippet(s.text, terms, e.ASK_SNIPPET_CHARS) }));
}
