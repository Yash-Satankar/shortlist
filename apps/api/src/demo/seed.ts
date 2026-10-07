import { createHash } from 'node:crypto';
import { normalizeCompanyName, normalizeQuestion, normalizeRoleTitle, canonicalJobUrl } from '@jt/shared';
import { eq, ne } from 'drizzle-orm';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { answerLibrary, applicationAnswers, applications, companies, emails, jobDescriptions, prepPacks, profiles, statusEvents, users } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { createUser } from '../users/service';
import { DEMO_APPLICATIONS, DEMO_LIBRARY, DEMO_PROFILE } from './data';

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * (Re)builds the demo account from fictional data, dated relative to now. Only on a demo
 * instance (DEMO_MODE=true), and never on a database that holds any other account: real data
 * can't be touched even if DEMO_MODE is set by mistake.
 */
export async function seedDemo(db: Db): Promise<{ applications: number }> {
  const e = env();
  if (!e.DEMO_MODE) throw new Error('Refusing to seed the demo: DEMO_MODE is not true');
  const email = e.DEMO_USER_EMAIL.toLowerCase();
  const [other] = await db.select({ id: users.id }).from(users).where(ne(users.email, email)).limit(1);
  if (other) throw new Error('Refusing to seed the demo: this database has accounts other than the demo account');

  await db.delete(users).where(eq(users.email, email));
  // Nobody signs in with this password: the demo is entered with "Try the demo".
  const user = await createUser(db, { email, password: sha256(`${Date.now()}${Math.random()}`), name: DEMO_PROFILE.fullName });
  const userId = user.id;
  const now = Date.now();

  await db.transaction(async (tx) => {
    await tx
      .update(profiles)
      .set({ ...DEMO_PROFILE, totalExperienceYears: String(DEMO_PROFILE.totalExperienceYears), resumeUpdatedAt: new Date(now - 20 * DAY) })
      .where(eq(profiles.userId, userId));
    for (const [i, [question, answer]] of DEMO_LIBRARY.entries()) {
      await tx.insert(answerLibrary).values({ userId, question, questionNormalized: normalizeQuestion(question), answer, sortOrder: i });
    }

    for (const a of DEMO_APPLICATIONS) {
      const [company] = await tx.insert(companies).values({ userId, name: a.company, normalizedName: normalizeCompanyName(a.company) }).returning({ id: companies.id });
      const appliedAt = new Date(now - (a.appliedDaysAgo ?? 2) * DAY);
      const last = a.events.filter((ev) => ev.disposition !== 'pending_review').at(-1);
      const canonical = canonicalJobUrl(a.jobUrl);
      const [app] = await tx
        .insert(applications)
        .values({
          userId,
          companyId: company!.id,
          roleTitle: a.role,
          roleNormalized: normalizeRoleTitle(a.role),
          location: a.location,
          workMode: a.workMode,
          source: a.source,
          sourceDetail: a.sourceDetail,
          jobUrl: a.jobUrl,
          jobUrlCanonical: canonical?.canonical ?? null,
          externalJobId: canonical?.externalId ?? null,
          salaryListed: a.salaryListed ?? null,
          experienceAsked: a.experienceAsked ?? null,
          notes: a.notes ?? null,
          status: last?.to ?? 'saved',
          statusChangedAt: last ? new Date(appliedAt.getTime() + last.day * DAY) : appliedAt,
          appliedOn: a.appliedDaysAgo == null ? null : isoDay(appliedAt),
          followUpOn: a.followUpInDays == null ? null : isoDay(new Date(now + a.followUpInDays * DAY)),
          lastActivityAt: new Date(appliedAt.getTime() + (a.events.at(-1)?.day ?? 0) * DAY),
          createdAt: appliedAt,
        })
        .returning({ id: applications.id });
      const applicationId = app!.id;

      await tx.insert(jobDescriptions).values({ userId, applicationId, content: a.jd, contentHash: createHash('sha256').update(a.jd).digest('hex'), source: 'extension', sourceUrl: a.jobUrl, capturedAt: appliedAt });
      // Saved shortly before applying, so the timeline reads in order.
      await tx.insert(statusEvents).values({ userId, applicationId, fromStatus: null, toStatus: 'saved', source: a.events[0]?.source ?? 'manual', occurredAt: new Date(appliedAt.getTime() - 3_600_000) });

      const emailIds = new Map<number, string>();
      for (const m of a.emails ?? []) {
        const [row] = await tx
          .insert(emails)
          .values({
            userId,
            source: 'imap',
            messageId: `<demo-${sha256(m.subject + a.company).slice(0, 16)}@demo.example>`,
            fromDomain: m.from.split('@')[1]!.replace('>', ''),
            fromEnc: m.from,
            subjectEnc: m.subject,
            excerptEnc: m.excerpt,
            receivedAt: new Date(appliedAt.getTime() + m.day * DAY),
            category: m.category,
            confidence: 0.85,
            classifiedBy: 'rules',
            outcome: 'applied',
            applicationId,
            matchedBy: 'company_role',
            expiresAt: new Date(now + 90 * DAY),
          })
          .returning({ id: emails.id });
        emailIds.set(m.day, row!.id);
      }

      let from: (typeof a.events)[number]['to'] | 'saved' = 'saved';
      for (const ev of a.events) {
        const pending = ev.disposition === 'pending_review';
        const evidence = ev.source === 'email' ? emailIds.get(ev.day) : undefined;
        await tx.insert(statusEvents).values({
          userId,
          applicationId,
          fromStatus: from,
          toStatus: ev.to,
          source: ev.source,
          disposition: pending ? 'pending_review' : 'applied',
          reason: pending ? 'Waiting for your review' : null,
          confidenceScore: ev.confidence ?? null,
          occurredAt: new Date(appliedAt.getTime() + ev.day * DAY),
          note: ev.note ?? null,
          evidenceType: evidence ? 'email' : null,
          evidenceId: evidence ?? null,
        });
        if (!pending) from = ev.to;
      }

      for (const [i, [question, answer]] of (a.answers ?? []).entries()) {
        await tx.insert(applicationAnswers).values({ userId, applicationId, question, answer, sortOrder: i });
      }
      if (a.prep) {
        await tx.insert(prepPacks).values({
          userId,
          applicationId,
          contentEnc: JSON.stringify(a.prep),
          jdHash: createHash('sha256').update(a.jd).digest('hex'),
          resumeHash: sha256(DEMO_PROFILE.resumeText),
          answersHash: sha256(JSON.stringify(DEMO_LIBRARY)),
          provider: 'together',
          model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
          costUsd: 0.004,
          generatedAt: new Date(now - 2 * DAY),
        });
      }
    }
  });
  return { applications: DEMO_APPLICATIONS.length };
}
