import { createHash } from 'node:crypto';
import {
  canonicalJobUrl,
  COMPANY_MATCH_THRESHOLD,
  findDuplicates,
  normalizeCompanyName,
  normalizeRoleTitle,
  type DuplicateLevel,
  type EventSource,
} from '@jt/shared';
import { and, asc, desc, eq, exists, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { escapeLike, findOrCreateCompany } from '../companies/service';
import { isUniqueViolation, type Db, type DbOrTx } from '../db/client';
import {
  applicationAnswers,
  applicationContacts,
  applications,
  companies,
  contacts,
  jobDescriptions,
  statusEvents,
} from '../db/schema';
import { dateIn } from '../lib/dates';
import { conflict, HttpError, notFound } from '../lib/http';
import { getUserSettings } from '../users/service';
import type { CreateApplicationInput, ListQuery, UpdateApplicationInput } from './schemas';

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------- duplicates

export interface DuplicateMatch {
  id: string;
  companyName: string;
  roleTitle: string;
  status: string;
  appliedOn: string | null;
  jobUrl: string | null;
  level: DuplicateLevel;
  roleSimilarity: number;
}

/**
 * Candidates are pre-filtered in SQL (same canonical URL, or company trigram
 * similarity), then scored with the shared rules so the web form and the
 * extension get exactly the same answer.
 */
export async function findDuplicateMatches(
  db: DbOrTx,
  userId: string,
  input: { companyName: string; roleTitle: string; jobUrl?: string | null; excludeId?: string },
): Promise<DuplicateMatch[]> {
  const companyNormalized = normalizeCompanyName(input.companyName);
  const roleNormalized = normalizeRoleTitle(input.roleTitle);
  const jobUrlCanonical = canonicalJobUrl(input.jobUrl)?.canonical ?? null;

  const rows = await db
    .select({
      id: applications.id,
      companyName: companies.name,
      companyNormalized: companies.normalizedName,
      roleTitle: applications.roleTitle,
      roleNormalized: applications.roleNormalized,
      jobUrl: applications.jobUrl,
      jobUrlCanonical: applications.jobUrlCanonical,
      status: applications.status,
      appliedOn: applications.appliedOn,
    })
    .from(applications)
    .innerJoin(companies, eq(companies.id, applications.companyId))
    .where(
      and(
        eq(applications.userId, userId),
        input.excludeId ? sql`${applications.id} <> ${input.excludeId}` : undefined,
        or(
          jobUrlCanonical ? eq(applications.jobUrlCanonical, jobUrlCanonical) : undefined,
          // Looser than the JS threshold; final scoring happens in findDuplicates.
          sql`similarity(${companies.normalizedName}, ${companyNormalized}) >= ${COMPANY_MATCH_THRESHOLD - 0.2}`,
        ),
      ),
    )
    .limit(50);

  return findDuplicates({ companyNormalized, roleNormalized, jobUrlCanonical }, rows).map(({ item, level, roleSimilarity }) => ({
    id: item.id,
    companyName: item.companyName,
    roleTitle: item.roleTitle,
    status: item.status,
    appliedOn: item.appliedOn,
    jobUrl: item.jobUrl,
    level,
    roleSimilarity: Math.round(roleSimilarity * 100) / 100,
  }));
}

// ---------------------------------------------------------------- create

export async function createApplication(db: Db, userId: string, input: CreateApplicationInput, source: EventSource) {
  const canonical = canonicalJobUrl(input.jobUrl);
  const matches = await findDuplicateMatches(db, userId, input);

  const exact = matches.filter((m) => m.level === 'exact');
  if (exact.length) {
    throw new HttpError(409, 'You already have this job saved', 'duplicate_exact', { matches: exact });
  }
  const likely = matches.filter((m) => m.level === 'likely');
  if (likely.length && !input.confirmDuplicate) {
    throw new HttpError(409, 'This looks like an application you already have', 'duplicate_likely', { matches: likely });
  }

  const { timezone } = await getUserSettings(db, userId);
  const now = new Date();

  try {
    const id = await db.transaction(async (tx) => {
      const company = await findOrCreateCompany(tx, userId, input.companyName);
      const appliedOn = input.appliedOn ?? (input.status !== 'saved' ? dateIn(now, timezone) : null);
      // For back-filled entries, the last known activity is the applied date, not "now".
      const lastActivityAt = input.appliedOn ? new Date(`${input.appliedOn}T12:00:00Z`) : now;

      const [app] = await tx
        .insert(applications)
        .values({
          userId,
          companyId: company.id,
          roleTitle: input.roleTitle,
          roleNormalized: normalizeRoleTitle(input.roleTitle),
          location: input.location ?? null,
          workMode: input.workMode ?? 'unknown',
          workModeDetail: input.workModeDetail ?? null,
          experienceAsked: input.experienceAsked ?? null,
          source: input.source ?? canonical?.source ?? 'other',
          sourceDetail: input.sourceDetail ?? null,
          jobUrl: input.jobUrl ?? null,
          jobUrlCanonical: canonical?.canonical ?? null,
          externalJobId: canonical?.externalId ?? null,
          salaryListed: input.salaryListed ?? null,
          salaryMinLpa: input.salaryMinLpa?.toString() ?? null,
          salaryMaxLpa: input.salaryMaxLpa?.toString() ?? null,
          expectedCtcEnc: input.expectedCtc ?? null,
          noticePeriodDays: input.noticePeriodDays ?? null,
          willingToRelocate: input.willingToRelocate ?? null,
          status: input.status,
          statusChangedAt: now,
          appliedOn,
          followUpOn: input.followUpOn ?? null,
          lastActivityAt,
          notes: input.notes ?? null,
        })
        .returning({ id: applications.id });

      await tx.insert(statusEvents).values({
        userId,
        applicationId: app!.id,
        fromStatus: null,
        toStatus: input.status,
        source,
        disposition: 'applied',
        reason: 'user_action',
        occurredAt: lastActivityAt,
      });

      if (input.jd) {
        await tx.insert(jobDescriptions).values({
          userId,
          applicationId: app!.id,
          content: input.jd,
          contentHash: sha256Hex(input.jd),
          source,
          sourceUrl: input.jobUrl ?? null,
        });
      }
      if (input.answers?.length) {
        await tx.insert(applicationAnswers).values(
          input.answers.map((a, i) => ({
            userId,
            applicationId: app!.id,
            question: a.question,
            answer: a.answer,
            libraryItemId: a.libraryItemId ?? null,
            sortOrder: i,
          })),
        );
      }
      return app!.id;
    });

    return {
      application: await getApplication(db, userId, id),
      // Same company, other roles: "you also applied to X here" (never blocks).
      hints: matches.filter((m) => m.level === 'hint'),
    };
  } catch (err) {
    // Lost a race with another create of the same posting.
    if (isUniqueViolation(err, 'applications_user_job_url_uq')) {
      throw new HttpError(409, 'You already have this job saved', 'duplicate_exact', { matches: [] });
    }
    throw err;
  }
}

// ---------------------------------------------------------------- read

async function loadOwned(db: DbOrTx, userId: string, id: string) {
  const app = await db.query.applications.findFirst({
    where: and(eq(applications.id, id), eq(applications.userId, userId)),
  });
  if (!app) throw notFound('Application not found');
  return app;
}

/** Full detail: application, company, JD (latest content + history), timeline, Q&A, contacts. */
export async function getApplication(db: DbOrTx, userId: string, id: string) {
  const app = await loadOwned(db, userId, id);
  const [company, jds, events, answers, contactRows] = await Promise.all([
    db.query.companies.findFirst({ where: eq(companies.id, app.companyId) }),
    db
      .select({
        id: jobDescriptions.id,
        source: jobDescriptions.source,
        sourceUrl: jobDescriptions.sourceUrl,
        capturedAt: jobDescriptions.capturedAt,
        length: sql<number>`length(${jobDescriptions.content})`.mapWith(Number),
      })
      .from(jobDescriptions)
      .where(eq(jobDescriptions.applicationId, id))
      .orderBy(desc(jobDescriptions.capturedAt)),
    db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.applicationId, id))
      .orderBy(asc(statusEvents.occurredAt), asc(statusEvents.recordedAt)),
    db
      .select()
      .from(applicationAnswers)
      .where(eq(applicationAnswers.applicationId, id))
      .orderBy(asc(applicationAnswers.sortOrder), asc(applicationAnswers.createdAt)),
    db
      .select({ contact: contacts })
      .from(applicationContacts)
      .innerJoin(contacts, eq(contacts.id, applicationContacts.contactId))
      .where(eq(applicationContacts.applicationId, id)),
  ]);

  const latestJd = jds[0]
    ? await db.query.jobDescriptions.findFirst({ where: eq(jobDescriptions.id, jds[0].id), columns: { content: true } })
    : undefined;

  return {
    ...serializeApplication(app),
    company: company ? { id: company.id, name: company.name, website: company.website, careersUrl: company.careersUrl } : null,
    jd: jds[0] ? { ...jds[0], content: latestJd!.content } : null,
    jdHistory: jds,
    timeline: events.map(serializeEvent),
    answers: answers.map(({ search: _s, userId: _u, ...a }) => a),
    contacts: contactRows.map(({ contact }) => serializeContact(contact)),
  };
}

export function serializeApplication(app: typeof applications.$inferSelect) {
  const { search: _search, userId: _userId, expectedCtcEnc, salaryMinLpa, salaryMaxLpa, ...rest } = app;
  return {
    ...rest,
    expectedCtc: expectedCtcEnc,
    salaryMinLpa: salaryMinLpa === null ? null : Number(salaryMinLpa),
    salaryMaxLpa: salaryMaxLpa === null ? null : Number(salaryMaxLpa),
  };
}

export function serializeEvent(e: typeof statusEvents.$inferSelect) {
  const { userId: _userId, ...rest } = e;
  return rest;
}

export function serializeContact(c: typeof contacts.$inferSelect) {
  return {
    id: c.id,
    companyId: c.companyId,
    role: c.role,
    name: c.nameEnc,
    email: c.emailEnc,
    phone: c.phoneEnc,
    linkedinUrl: c.linkedinUrlEnc,
    notes: c.notesEnc,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ---------------------------------------------------------------- list / search

export async function listApplications(db: DbOrTx, userId: string, q: ListQuery) {
  const filters: (SQL | undefined)[] = [eq(applications.userId, userId)];

  if (q.archived === 'false') filters.push(isNull(applications.archivedAt));
  if (q.archived === 'true') filters.push(isNotNull(applications.archivedAt));
  if (q.status?.length) filters.push(inArray(applications.status, q.status));
  if (q.source?.length) filters.push(inArray(applications.source, q.source));
  if (q.workMode?.length) filters.push(inArray(applications.workMode, q.workMode));
  if (q.city) filters.push(ilike(applications.location, `%${escapeLike(q.city)}%`));
  if (q.appliedFrom) filters.push(gte(applications.appliedOn, q.appliedFrom));
  if (q.appliedTo) filters.push(lte(applications.appliedOn, q.appliedTo));

  if (q.q) {
    // Full-text over role/notes, JD snapshots and Q&A, plus substring on company name.
    const tsq = sql`websearch_to_tsquery('english', ${q.q})`;
    filters.push(
      or(
        sql`${applications.search} @@ ${tsq}`,
        ilike(companies.name, `%${escapeLike(q.q)}%`),
        ilike(applications.roleTitle, `%${escapeLike(q.q)}%`),
        exists(
          db
            .select({ one: sql`1` })
            .from(jobDescriptions)
            .where(and(eq(jobDescriptions.applicationId, applications.id), sql`${jobDescriptions.search} @@ ${tsq}`)),
        ),
        exists(
          db
            .select({ one: sql`1` })
            .from(applicationAnswers)
            .where(and(eq(applicationAnswers.applicationId, applications.id), sql`${applicationAnswers.search} @@ ${tsq}`)),
        ),
      ),
    );
  }

  const order = {
    applied_desc: [sql`${applications.appliedOn} desc nulls first`, desc(applications.createdAt)],
    applied_asc: [sql`${applications.appliedOn} asc nulls last`, asc(applications.createdAt)],
    updated_desc: [desc(applications.statusChangedAt)],
    company_asc: [asc(companies.name), asc(applications.roleTitle)],
  }[q.sort];

  const where = and(...filters);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select({
        app: applications,
        companyName: companies.name,
        hasJd: sql<boolean>`exists (select 1 from ${jobDescriptions} where ${jobDescriptions.applicationId} = ${applications.id})`,
        pendingReviews: sql<number>`(select count(*) from ${statusEvents} where ${statusEvents.applicationId} = ${applications.id} and ${statusEvents.disposition} = 'pending_review')`.mapWith(Number),
      })
      .from(applications)
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(where)
      .orderBy(...order)
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(applications)
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(where),
  ]);

  return {
    items: rows.map((r) => ({
      ...serializeApplication(r.app),
      companyName: r.companyName,
      hasJd: r.hasJd,
      pendingReviews: r.pendingReviews,
    })),
    total,
  };
}

// ---------------------------------------------------------------- update / delete

export async function updateApplication(db: Db, userId: string, id: string, input: UpdateApplicationInput) {
  await db.transaction(async (tx) => {
    const app = await loadOwned(tx, userId, id);
    const set: Partial<typeof applications.$inferInsert> = {};

    if (input.companyName !== undefined) set.companyId = (await findOrCreateCompany(tx, userId, input.companyName)).id;
    if (input.roleTitle !== undefined) {
      set.roleTitle = input.roleTitle;
      set.roleNormalized = normalizeRoleTitle(input.roleTitle);
    }
    if (input.jobUrl !== undefined) {
      const canonical = canonicalJobUrl(input.jobUrl);
      set.jobUrl = input.jobUrl;
      set.jobUrlCanonical = canonical?.canonical ?? null;
      set.externalJobId = canonical?.externalId ?? null;
    }
    if (input.archived !== undefined) set.archivedAt = input.archived ? (app.archivedAt ?? new Date()) : null;
    if (input.expectedCtc !== undefined) set.expectedCtcEnc = input.expectedCtc;
    if (input.salaryMinLpa !== undefined) set.salaryMinLpa = input.salaryMinLpa?.toString() ?? null;
    if (input.salaryMaxLpa !== undefined) set.salaryMaxLpa = input.salaryMaxLpa?.toString() ?? null;

    const passthrough = [
      'location',
      'workMode',
      'workModeDetail',
      'experienceAsked',
      'source',
      'sourceDetail',
      'noticePeriodDays',
      'willingToRelocate',
      'appliedOn',
      'followUpOn',
      'notes',
      'salaryListed',
    ] as const;
    for (const key of passthrough) {
      if (input[key] !== undefined) (set as Record<string, unknown>)[key] = input[key];
    }

    try {
      await tx.update(applications).set(set).where(eq(applications.id, id));
    } catch (err) {
      if (isUniqueViolation(err, 'applications_user_job_url_uq')) {
        throw conflict('Another application already uses this job URL');
      }
      throw err;
    }
  });
  return getApplication(db, userId, id);
}

/** Hard delete (for mistakes). Prefer archiving; the timeline goes with it. */
export async function deleteApplication(db: Db, userId: string, id: string) {
  const deleted = await db
    .delete(applications)
    .where(and(eq(applications.id, id), eq(applications.userId, userId)))
    .returning({ id: applications.id });
  if (!deleted.length) throw notFound('Application not found');
}

// ---------------------------------------------------------------- JD, answers, contacts

export async function addJobDescription(
  db: Db,
  userId: string,
  applicationId: string,
  input: { content: string; sourceUrl?: string | null },
  source: EventSource,
) {
  await loadOwned(db, userId, applicationId);
  const contentHash = sha256Hex(input.content);
  const [inserted] = await db
    .insert(jobDescriptions)
    .values({ userId, applicationId, content: input.content, contentHash, source, sourceUrl: input.sourceUrl ?? null })
    .onConflictDoNothing({ target: [jobDescriptions.applicationId, jobDescriptions.contentHash] })
    .returning({ id: jobDescriptions.id });
  // Identical text was already captured: keep the original snapshot.
  return { created: Boolean(inserted) };
}

export async function getJobDescription(db: Db, userId: string, applicationId: string, jdId: string) {
  const jd = await db.query.jobDescriptions.findFirst({
    where: and(eq(jobDescriptions.id, jdId), eq(jobDescriptions.applicationId, applicationId), eq(jobDescriptions.userId, userId)),
  });
  if (!jd) throw notFound('Job description not found');
  const { search: _s, userId: _u, ...rest } = jd;
  return rest;
}

export async function replaceAnswers(
  db: Db,
  userId: string,
  applicationId: string,
  answers: Array<{ question: string; answer: string; libraryItemId?: string | null }>,
) {
  await db.transaction(async (tx) => {
    await loadOwned(tx, userId, applicationId);
    await tx.delete(applicationAnswers).where(eq(applicationAnswers.applicationId, applicationId));
    if (answers.length) {
      await tx.insert(applicationAnswers).values(
        answers.map((a, i) => ({
          userId,
          applicationId,
          question: a.question,
          answer: a.answer,
          libraryItemId: a.libraryItemId ?? null,
          sortOrder: i,
        })),
      );
    }
  });
}

export async function addContact(
  db: Db,
  userId: string,
  applicationId: string,
  input: { name: string; role: (typeof contacts.$inferInsert)['role']; email?: string | null; phone?: string | null; linkedinUrl?: string | null; notes?: string | null },
) {
  return db.transaction(async (tx) => {
    const app = await loadOwned(tx, userId, applicationId);
    const [contact] = await tx
      .insert(contacts)
      .values({
        userId,
        companyId: app.companyId,
        role: input.role,
        nameEnc: input.name,
        emailEnc: input.email ?? null,
        phoneEnc: input.phone ?? null,
        linkedinUrlEnc: input.linkedinUrl ?? null,
        notesEnc: input.notes ?? null,
      })
      .returning();
    await tx.insert(applicationContacts).values({ userId, applicationId, contactId: contact!.id });
    return serializeContact(contact!);
  });
}

export async function updateContact(
  db: Db,
  userId: string,
  contactId: string,
  input: Partial<{ name: string; role: (typeof contacts.$inferInsert)['role']; email: string | null; phone: string | null; linkedinUrl: string | null; notes: string | null }>,
) {
  const set: Partial<typeof contacts.$inferInsert> = {};
  if (input.name !== undefined) set.nameEnc = input.name;
  if (input.role !== undefined) set.role = input.role;
  if (input.email !== undefined) set.emailEnc = input.email;
  if (input.phone !== undefined) set.phoneEnc = input.phone;
  if (input.linkedinUrl !== undefined) set.linkedinUrlEnc = input.linkedinUrl;
  if (input.notes !== undefined) set.notesEnc = input.notes;
  if (!Object.keys(set).length) throw new HttpError(400, 'Nothing to update', 'bad_request');
  const [contact] = await db
    .update(contacts)
    .set(set)
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)))
    .returning();
  if (!contact) throw notFound('Contact not found');
  return serializeContact(contact);
}

export async function deleteContact(db: Db, userId: string, contactId: string) {
  const deleted = await db
    .delete(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)))
    .returning({ id: contacts.id });
  if (!deleted.length) throw notFound('Contact not found');
}
