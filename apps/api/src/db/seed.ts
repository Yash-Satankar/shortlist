import { createHash } from 'node:crypto';
import {
  normalizeCompanyName,
  normalizeQuestion,
  normalizeRoleTitle,
  type ApplicationSource,
  type ApplicationStatus,
  type WorkMode,
} from '@jt/shared';
import { and, eq, notExists, sql } from 'drizzle-orm';
import { normalizeEmail, createUser } from '../users/service';
import type { Db } from './client';
import {
  answerLibrary,
  applicationAnswers,
  applications,
  companies,
  jobDescriptions,
  statusEvents,
  users,
} from './schema';

/**
 * Usage:
 *   pnpm db:seed                 ensure the account from SEED_USER_EMAIL / SEED_USER_PASSWORD exists
 *   pnpm db:seed --demo          also add fictional demo applications (rows tagged is_demo)
 *   pnpm db:seed --remove-demo   delete only is_demo rows (child rows go via ON DELETE CASCADE)
 *
 * Development only: refuses to run when NODE_ENV=production, and nothing calls it on boot.
 * In production create the account with `pnpm user:create`. Real data comes from the .xlsx importer.
 */

export async function ensureSeedUser(db: Db): Promise<string> {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) throw new Error('Set SEED_USER_EMAIL and SEED_USER_PASSWORD in .env');

  const existing = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(email)) });
  if (existing) {
    console.log(`User ${existing.email} already exists.`);
    return existing.id;
  }
  const user = await createUser(db, { email, password, name: process.env.SEED_USER_NAME ?? null });
  console.log(`Created user ${user.email}.`);
  return user.id;
}

interface DemoApp {
  company: string;
  role: string;
  location: string;
  workMode: WorkMode;
  source: ApplicationSource;
  daysAgo: number;
  path: ApplicationStatus[];
  jd: string;
  answers?: Array<[string, string]>;
}

const DEMO_APPS: DemoApp[] = [
  {
    company: 'Acme Payments Pvt Ltd',
    role: 'Backend Developer (Node.js)',
    location: 'Bengaluru',
    workMode: 'hybrid',
    source: 'linkedin',
    daysAgo: 14,
    path: ['applied'],
    jd: 'We are looking for a Node.js backend developer with 2-4 years of experience in Express, PostgreSQL and Redis. Experience with AWS is a plus.',
    answers: [
      ['Years of experience with Node.js', '3'],
      ['Expected CTC (LPA)', '12'],
    ],
  },
  {
    company: 'Nimbus Cloud Technologies',
    role: 'Senior Software Engineer - Node',
    location: 'Pune',
    workMode: 'remote',
    source: 'greenhouse',
    daysAgo: 9,
    path: ['applied', 'assessment'],
    jd: 'Senior engineer to own TypeScript microservices. Strong SQL, system design, and experience with message queues required.',
  },
  {
    company: 'Orbit Labs',
    role: 'Full Stack Developer',
    location: 'Hyderabad',
    workMode: 'onsite',
    source: 'lever',
    daysAgo: 20,
    path: ['applied', 'shortlisted', 'interview'],
    jd: 'Full stack role: React + Node.js. You will build internal dashboards and REST APIs. 3+ years experience.',
  },
  {
    company: 'Quantico Analytics',
    role: 'Node.js Developer',
    location: 'Remote',
    workMode: 'remote',
    source: 'naukri',
    daysAgo: 30,
    path: ['applied', 'rejected'],
    jd: 'Node.js developer for data ingestion pipelines. Kafka experience preferred.',
  },
  {
    company: 'Helio Systems',
    role: 'Backend Engineer',
    location: 'Noida',
    workMode: 'hybrid',
    source: 'company_portal',
    daysAgo: 1,
    path: [],
    jd: 'Backend engineer (Node.js/Go) for an IoT platform. MySQL and MQTT experience preferred.',
  },
];

const DEMO_LIBRARY: Array<[string, string]> = [
  ['Total experience', '3 years'],
  ['Notice period', 'Immediate'],
  ['Expected CTC', '12 LPA'],
  ['Willing to relocate', 'Yes'],
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function seedDemo(db: Db, userId: string) {
  const existing = await db.query.applications.findFirst({ where: eq(applications.userId, userId) });
  if (existing) {
    console.log('User already has applications; skipping demo data.');
    return;
  }

  await db.transaction(async (tx) => {
    for (const [i, [question, answer]] of DEMO_LIBRARY.entries()) {
      await tx
        .insert(answerLibrary)
        .values({ userId, question, questionNormalized: normalizeQuestion(question), answer, sortOrder: i, isDemo: true })
        .onConflictDoNothing();
    }

    for (const demo of DEMO_APPS) {
      const normalizedName = normalizeCompanyName(demo.company);
      await tx.insert(companies).values({ userId, name: demo.company, normalizedName, isDemo: true }).onConflictDoNothing();
      const company = await tx.query.companies.findFirst({
        where: and(eq(companies.userId, userId), eq(companies.normalizedName, normalizedName)),
      });

      const appliedAt = new Date(Date.now() - demo.daysAgo * 86_400_000);
      const finalStatus = demo.path.at(-1) ?? 'saved';
      const [app] = await tx
        .insert(applications)
        .values({
          userId,
          companyId: company!.id,
          roleTitle: demo.role,
          roleNormalized: normalizeRoleTitle(demo.role),
          location: demo.location,
          workMode: demo.workMode,
          source: demo.source,
          status: finalStatus,
          appliedOn: demo.path.length ? isoDate(appliedAt) : null,
          notes: 'Demo record',
          isDemo: true,
        })
        .returning({ id: applications.id });

      await tx.insert(jobDescriptions).values({
        userId,
        applicationId: app!.id,
        content: demo.jd,
        contentHash: createHash('sha256').update(demo.jd).digest('hex'),
        source: 'manual',
        capturedAt: appliedAt,
      });

      let from: ApplicationStatus | null = null;
      const steps: ApplicationStatus[] = ['saved', ...demo.path];
      for (const [i, to] of steps.entries()) {
        const occurredAt = new Date(appliedAt.getTime() + i * 2 * 86_400_000);
        await tx.insert(statusEvents).values({
          userId,
          applicationId: app!.id,
          fromStatus: from,
          toStatus: to,
          source: i === 0 ? 'manual' : 'email',
          occurredAt,
        });
        from = to;
      }
      await tx
        .update(applications)
        .set({ statusChangedAt: new Date(appliedAt.getTime() + (steps.length - 1) * 2 * 86_400_000) })
        .where(eq(applications.id, app!.id));

      for (const [i, [question, answer]] of (demo.answers ?? []).entries()) {
        await tx.insert(applicationAnswers).values({ userId, applicationId: app!.id, question, answer, sortOrder: i });
      }
    }
  });
  console.log(`Added ${DEMO_APPS.length} demo applications.`);
}

/** Deletes demo rows only. Real rows are never touched, even in the same tables. */
export async function removeDemo(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const apps = await tx
      .delete(applications)
      .where(and(eq(applications.userId, userId), eq(applications.isDemo, true)))
      .returning({ id: applications.id });
    const answers = await tx
      .delete(answerLibrary)
      .where(and(eq(answerLibrary.userId, userId), eq(answerLibrary.isDemo, true)))
      .returning({ id: answerLibrary.id });
    // A demo company that real applications now point to (e.g. imported later) is kept and un-flagged.
    const companiesRemoved = await tx
      .delete(companies)
      .where(
        and(
          eq(companies.userId, userId),
          eq(companies.isDemo, true),
          notExists(tx.select({ one: sql`1` }).from(applications).where(eq(applications.companyId, companies.id))),
        ),
      )
      .returning({ id: companies.id });
    await tx
      .update(companies)
      .set({ isDemo: false })
      .where(and(eq(companies.userId, userId), eq(companies.isDemo, true)));
    return { applications: apps.length, answers: answers.length, companies: companiesRemoved.length };
  });
}
