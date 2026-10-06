import { and, asc, count, eq, ne } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client';
import {
  answerLibrary,
  applicationAnswers,
  applicationContacts,
  applications,
  companies,
  contacts,
  emails,
  jobDescriptions,
  llmUsage,
  prepPacks,
  statusEvents,
  users,
} from '../db/schema';
import { forbidden, unauthorized } from '../lib/http';
import { verifyPassword } from '../lib/password';
import { getProfile } from '../profile/service';

/**
 * Your data, all of it: a JSON export (everything you own, decrypted for you) and a CSV of
 * applications. Never included: password hash, sessions, extension tokens, AI keys.
 */
export async function exportUserData(db: DbOrTx, userId: string) {
  const [user] = await db.select({ email: users.email, name: users.name, role: users.role, settings: users.settings, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  const mine = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, userId);
  const apps = await db
    .select({
      id: applications.id,
      company: companies.name,
      roleTitle: applications.roleTitle,
      status: applications.status,
      source: applications.source,
      sourceDetail: applications.sourceDetail,
      location: applications.location,
      workMode: applications.workMode,
      workModeDetail: applications.workModeDetail,
      experienceAsked: applications.experienceAsked,
      jobUrl: applications.jobUrl,
      salaryListed: applications.salaryListed,
      salaryMinLpa: applications.salaryMinLpa,
      salaryMaxLpa: applications.salaryMaxLpa,
      expectedCtc: applications.expectedCtcEnc,
      noticePeriodDays: applications.noticePeriodDays,
      willingToRelocate: applications.willingToRelocate,
      appliedOn: applications.appliedOn,
      followUpOn: applications.followUpOn,
      statusChangedAt: applications.statusChangedAt,
      notes: applications.notes,
      archivedAt: applications.archivedAt,
      createdAt: applications.createdAt,
    })
    .from(applications)
    .innerJoin(companies, eq(companies.id, applications.companyId))
    .where(eq(applications.userId, userId))
    .orderBy(asc(applications.createdAt));
  const strip = <T extends Record<string, unknown>>(rows: T[], ...keys: (keyof T)[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k as keyof T))));
  return {
    exportedAt: new Date().toISOString(),
    format: 'job-tracker-export/1',
    account: user,
    profile: await getProfile(db, userId),
    applications: apps,
    jobDescriptions: strip(await db.select().from(jobDescriptions).where(mine(jobDescriptions)), 'userId', 'search'),
    timeline: strip(await db.select().from(statusEvents).where(mine(statusEvents)).orderBy(asc(statusEvents.occurredAt)), 'userId'),
    screeningAnswers: strip(await db.select().from(applicationAnswers).where(mine(applicationAnswers)), 'userId', 'search'),
    answerLibrary: strip(await db.select().from(answerLibrary).where(mine(answerLibrary)), 'userId'),
    contacts: strip(await db.select().from(contacts).where(mine(contacts)), 'userId'),
    applicationContacts: strip(await db.select().from(applicationContacts).where(mine(applicationContacts)), 'userId'),
    emails: strip(await db.select().from(emails).where(mine(emails)), 'userId'),
    prepPacks: (await db.select().from(prepPacks).where(mine(prepPacks))).map(({ userId: _u, contentEnc, ...rest }) => ({ ...rest, content: JSON.parse(contentEnc) })),
    aiUsage: strip(await db.select().from(llmUsage).where(mine(llmUsage)), 'userId'),
  };
}

const CSV_COLUMNS = ['company', 'roleTitle', 'status', 'source', 'sourceDetail', 'location', 'workMode', 'experienceAsked', 'appliedOn', 'followUpOn', 'statusChangedAt', 'jobUrl', 'salaryListed', 'notes', 'archivedAt', 'createdAt'] as const;

const csvCell = (v: unknown) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Quote everything that needs it; neutralize spreadsheet formulas (=, +, -, @ at the start).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function applicationsCsv(apps: Record<string, unknown>[]): string {
  return [CSV_COLUMNS.join(','), ...apps.map((a) => CSV_COLUMNS.map((c) => csvCell(a[c])).join(','))].join('\r\n') + '\r\n';
}

/**
 * Deletes the account and everything it owns (every user table cascades from users), including
 * its AI cache and usage. Needs the password. The last admin can't leave while others remain.
 */
export async function deleteAccount(db: Db, userId: string, password: string): Promise<void> {
  const [u] = await db.select({ hash: users.passwordHash, role: users.role }).from(users).where(eq(users.id, userId));
  if (!u || !(await verifyPassword(u.hash, password))) throw unauthorized('That password is incorrect');
  if (u.role === 'admin') {
    const [others] = await db.select({ n: count() }).from(users).where(ne(users.id, userId));
    const [admins] = await db.select({ n: count() }).from(users).where(and(eq(users.role, 'admin'), ne(users.id, userId)));
    if (others!.n > 0 && admins!.n === 0) throw forbidden('You’re the only admin. Make another account admin first (pnpm user:admin), or remove the other accounts.');
  }
  await db.delete(users).where(eq(users.id, userId));
}
