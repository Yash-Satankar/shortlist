import { canonicalJobUrl, normalizeCompanyName, normalizeQuestion, normalizeRoleTitle } from '@jt/shared';
import { eq } from 'drizzle-orm';
import { findDuplicateMatches } from '../applications/service';
import { findOrCreateCompany } from '../companies/service';
import type { Db, DbOrTx } from '../db/client';
import { answerLibrary, applications, profiles, statusEvents } from '../db/schema';
import type { ImportIssue, ParsedAnswer, ParsedApplicationRow, ParsedWorkbook } from './tracker-xlsx';

/**
 * Two-phase import: planImport() is the dry run (reads only); commitImport()
 * re-plans inside one transaction and writes. Re-running is idempotent: rows
 * already imported (same import key or same job URL) are reported as "exists".
 */

export type RowAction = 'create' | 'exists' | 'possible_duplicate' | 'duplicate_in_file';

export interface PlannedRow {
  action: RowAction;
  importKey: string;
  row: ParsedApplicationRow;
  /** For exists / possible_duplicate / duplicate_in_file: what it matched. */
  match?: { id?: string; label: string };
}

type ProfileField = 'currentCtcEnc' | 'expectedCtcEnc' | 'noticePeriodDays' | 'relocation' | 'currentLocation' | 'totalExperienceYears';

interface ProfileRule {
  match: RegExp;
  field: ProfileField;
  parse?: (answer: string) => string | number | null;
  /** Sensitive values (CTC) stay out of the plaintext answer library; they're encrypted on the profile. */
  library: boolean;
}

const PROFILE_RULES: ProfileRule[] = [
  { match: /^current (ctc|salary|compensation)/i, field: 'currentCtcEnc', library: false },
  { match: /^(expected|desired) (ctc|salary|compensation)/i, field: 'expectedCtcEnc', library: false },
  { match: /^notice period/i, field: 'noticePeriodDays', parse: parseNoticeDays, library: true },
  { match: /^relocat/i, field: 'relocation', library: true },
  { match: /^current location/i, field: 'currentLocation', library: true },
  { match: /^total experience/i, field: 'totalExperienceYears', parse: (a) => /(\d+(?:\.\d+)?)/.exec(a)?.[1] ?? null, library: true },
];
const SENSITIVE_QUESTION = /\b(ctc|salary|compensation|package)\b/i;

export function parseNoticeDays(answer: string): number | null {
  if (/immediate/i.test(answer)) return 0;
  const days = /(\d+)\s*days?/i.exec(answer);
  if (days) return Number(days[1]);
  const months = /(\d+)\s*months?/i.exec(answer);
  return months ? Number(months[1]) * 30 : null;
}

export interface AnswerPlan {
  library: Array<{ question: string; answer: string; action: 'create' | 'exists' }>;
  profile: Array<{ question: string; field: ProfileField; action: 'set' | 'already_set' }>;
  skippedSensitive: string[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  answers: AnswerPlan;
  issues: ImportIssue[];
  summary: {
    rows: number;
    create: number;
    exists: number;
    possibleDuplicates: number;
    duplicatesInFile: number;
    errors: number;
    warnings: number;
    libraryCreate: number;
    libraryExists: number;
    profileFields: number;
  };
}

export function importKeyFor(row: ParsedApplicationRow): string {
  const canonical = canonicalJobUrl(row.jobUrl)?.canonical;
  if (canonical) return `url:${canonical}`;
  return `row:${normalizeCompanyName(row.companyName)}|${normalizeRoleTitle(row.roleTitle)}|${row.appliedOn ?? ''}`;
}

const label = (r: { companyName: string; roleTitle: string }) => `${r.companyName} — ${r.roleTitle}`;

export async function planImport(db: DbOrTx, userId: string, parsed: ParsedWorkbook): Promise<ImportPlan> {
  const existing = await db
    .select({ id: applications.id, importKey: applications.importKey, jobUrlCanonical: applications.jobUrlCanonical })
    .from(applications)
    .where(eq(applications.userId, userId));
  const byImportKey = new Map(existing.filter((e) => e.importKey).map((e) => [e.importKey!, e.id]));
  const byUrl = new Map(existing.filter((e) => e.jobUrlCanonical).map((e) => [e.jobUrlCanonical!, e.id]));

  const seen = new Map<string, ParsedApplicationRow>();
  const rows: PlannedRow[] = [];

  for (const row of parsed.applications) {
    const importKey = importKeyFor(row);
    const canonical = canonicalJobUrl(row.jobUrl)?.canonical;

    const earlier = seen.get(importKey);
    if (earlier) {
      rows.push({ action: 'duplicate_in_file', importKey, row, match: { label: `row #${earlier.ref ?? earlier.sheetRow}` } });
      continue;
    }
    seen.set(importKey, row);

    const existingId = byImportKey.get(importKey) ?? (canonical ? byUrl.get(canonical) : undefined);
    if (existingId) {
      rows.push({ action: 'exists', importKey, row, match: { id: existingId, label: 'already in tracker' } });
      continue;
    }

    const likely = (await findDuplicateMatches(db, userId, row)).find((m) => m.level === 'likely' || m.level === 'exact');
    if (likely) {
      rows.push({ action: 'possible_duplicate', importKey, row, match: { id: likely.id, label: label(likely) } });
      continue;
    }
    rows.push({ action: 'create', importKey, row });
  }

  const answers = await planAnswers(db, userId, parsed.answers);
  const count = (a: RowAction) => rows.filter((r) => r.action === a).length;

  return {
    rows,
    answers,
    issues: parsed.issues,
    summary: {
      rows: parsed.applications.length,
      create: count('create'),
      exists: count('exists'),
      possibleDuplicates: count('possible_duplicate'),
      duplicatesInFile: count('duplicate_in_file'),
      errors: parsed.issues.filter((i) => i.severity === 'error').length,
      warnings: parsed.issues.filter((i) => i.severity === 'warning').length,
      libraryCreate: answers.library.filter((a) => a.action === 'create').length,
      libraryExists: answers.library.filter((a) => a.action === 'exists').length,
      profileFields: answers.profile.filter((p) => p.action === 'set').length,
    },
  };
}

async function planAnswers(db: DbOrTx, userId: string, answers: ParsedAnswer[]): Promise<AnswerPlan> {
  const [libraryRows, profile] = await Promise.all([
    db.select({ q: answerLibrary.questionNormalized }).from(answerLibrary).where(eq(answerLibrary.userId, userId)),
    db.query.profiles.findFirst({ where: eq(profiles.userId, userId) }),
  ]);
  const inLibrary = new Set(libraryRows.map((r) => r.q));
  const plan: AnswerPlan = { library: [], profile: [], skippedSensitive: [] };

  for (const { question, answer } of answers) {
    const rule = PROFILE_RULES.find((r) => r.match.test(question));
    if (rule) {
      plan.profile.push({ question, field: rule.field, action: profile?.[rule.field] == null ? 'set' : 'already_set' });
      if (!rule.library) continue;
    } else if (SENSITIVE_QUESTION.test(question)) {
      plan.skippedSensitive.push(question);
      continue;
    }
    const key = normalizeQuestion(question);
    plan.library.push({ question, answer, action: inLibrary.has(key) ? 'exists' : 'create' });
    inLibrary.add(key);
  }
  return plan;
}

/** Midday UTC keeps a date-only value on the same calendar day in every Indian/European/US timezone. */
const atNoonUtc = (date: string) => new Date(`${date}T12:00:00Z`);

export async function commitImport(db: Db, userId: string, parsed: ParsedWorkbook, fileName: string): Promise<ImportPlan> {
  return db.transaction(async (tx) => {
    const plan = await planImport(tx, userId, parsed);
    const now = new Date();

    for (const { action, importKey, row } of plan.rows) {
      if (action !== 'create') continue;
      const company = await findOrCreateCompany(tx, userId, row.companyName);
      const canonical = canonicalJobUrl(row.jobUrl);
      const occurredAt = row.appliedOn ? atNoonUtc(row.appliedOn) : now;
      const lastActivityAt = row.lastUpdateOn ? atNoonUtc(row.lastUpdateOn) : occurredAt;

      const [app] = await tx
        .insert(applications)
        .values({
          userId,
          companyId: company.id,
          roleTitle: row.roleTitle,
          roleNormalized: normalizeRoleTitle(row.roleTitle),
          location: row.location,
          workMode: row.workMode,
          workModeDetail: row.workModeDetail,
          experienceAsked: row.experienceAsked,
          source: row.source,
          sourceDetail: row.sourceDetail,
          jobUrl: row.jobUrl,
          jobUrlCanonical: canonical?.canonical ?? null,
          externalJobId: canonical?.externalId ?? null,
          importKey,
          status: row.status,
          statusChangedAt: lastActivityAt,
          appliedOn: row.appliedOn,
          followUpOn: row.followUpOn,
          lastActivityAt,
          notes: row.notes,
        })
        .returning({ id: applications.id });

      // Exactly one timeline event per imported row, dated by the sheet's Date Applied.
      await tx.insert(statusEvents).values({
        userId,
        applicationId: app!.id,
        fromStatus: null,
        toStatus: row.status,
        source: 'import',
        disposition: 'applied',
        reason: 'user_action',
        occurredAt,
        note: `Imported from ${fileName}, row #${row.ref ?? row.sheetRow}`,
      });
    }

    await commitAnswers(tx, userId, parsed.answers, plan.answers);
    return plan;
  });
}

async function commitAnswers(tx: DbOrTx, userId: string, answers: ParsedAnswer[], plan: AnswerPlan) {
  const toCreate = plan.library.filter((a) => a.action === 'create');
  if (toCreate.length) {
    await tx
      .insert(answerLibrary)
      .values(
        toCreate.map((a, i) => ({
          userId,
          question: a.question,
          questionNormalized: normalizeQuestion(a.question),
          answer: a.answer,
          sortOrder: i,
        })),
      )
      .onConflictDoNothing();
  }

  const set: Partial<typeof profiles.$inferInsert> = {};
  for (const p of plan.profile) {
    if (p.action !== 'set') continue;
    const rule = PROFILE_RULES.find((r) => r.field === p.field)!;
    const answer = answers.find((a) => a.question === p.question)!.answer;
    const value = rule.parse ? rule.parse(answer) : answer;
    if (value !== null) (set as Record<string, unknown>)[p.field] = value;
  }
  if (Object.keys(set).length) {
    await tx.insert(profiles).values({ userId, ...set }).onConflictDoUpdate({ target: profiles.userId, set });
  }
}
