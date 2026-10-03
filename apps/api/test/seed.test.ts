import { normalizeCompanyName, normalizeQuestion, normalizeRoleTitle } from '@jt/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../src/db/client';
import { answerLibrary, applications, companies, jobDescriptions, statusEvents } from '../src/db/schema';
import { removeDemo, seedDemo } from '../src/db/seed';
import { createUser } from '../src/users/service';
import { resetDb } from './helpers';

const db = getDb();
let userId: string;

beforeEach(async () => {
  await resetDb();
  userId = (await createUser(db, { email: 'demo@example.com', password: 'correct horse battery' })).id;
});

afterAll(closeDb);

describe('demo data', () => {
  it('removes only demo rows, keeping real rows in the same tables', async () => {
    await seedDemo(db, userId);

    // A real application at a company that also exists as demo data, plus a real library answer.
    const demoCompany = await db.query.companies.findFirst({
      where: and(eq(companies.userId, userId), eq(companies.normalizedName, normalizeCompanyName('Orbit Labs'))),
    });
    const [real] = await db
      .insert(applications)
      .values({
        userId,
        companyId: demoCompany!.id,
        roleTitle: 'Platform Engineer',
        roleNormalized: normalizeRoleTitle('Platform Engineer'),
        status: 'applied',
      })
      .returning();
    await db.insert(answerLibrary).values({ userId, question: 'Node.js', questionNormalized: normalizeQuestion('Node.js'), answer: '3 years' });

    const removed = await removeDemo(db, userId);
    expect(removed.applications).toBe(5);
    expect(removed.answers).toBe(4);
    expect(removed.companies).toBe(4); // Orbit Labs survives: a real application uses it

    const apps = await db.select().from(applications).where(eq(applications.userId, userId));
    expect(apps.map((a) => a.id)).toEqual([real!.id]);

    const keptCompany = await db.query.companies.findFirst({ where: eq(companies.id, demoCompany!.id) });
    expect(keptCompany?.isDemo).toBe(false);

    const library = await db.select().from(answerLibrary).where(eq(answerLibrary.userId, userId));
    expect(library.map((l) => l.answer)).toEqual(['3 years']);

    // Children of demo applications went with them (cascade), no truncation needed.
    expect(await db.select().from(jobDescriptions)).toHaveLength(0);
    expect(await db.select().from(statusEvents)).toHaveLength(0);
  });

  it('is a no-op when there is nothing to remove', async () => {
    expect(await removeDemo(db, userId)).toEqual({ applications: 0, answers: 0, companies: 0 });
  });
});
