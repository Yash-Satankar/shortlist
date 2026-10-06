import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { planSchema, runExactQuery } from '../src/ask/query';
import { searchUserData } from '../src/ask/search';
import { closeDb, getDb } from '../src/db/client';
import { applications, emails } from '../src/db/schema';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

/**
 * Ask eval: 20 real-style questions over seeded fictional data, with the records each answer
 * must rest on. Counting/listing questions: given the plan the model is asked to produce, the
 * database must return exactly the expected applications. Open questions: the expected records
 * must be among the sources sent to the model (retrieval), and nothing from another user.
 * No model is called here: this checks everything around it.
 */
const db = getDb();
const app = createApp({ db });
const PASSWORD = 'correct horse battery';
const TZ = 'Asia/Kolkata';
const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * DAY));

type Seed = {
  key: string;
  companyName: string;
  roleTitle: string;
  source: string;
  appliedOn: string;
  location?: string;
  salaryListed?: string;
  notes?: string;
  jd?: string;
  answers?: { question: string; answer: string }[];
  /** Status changes: [status, ISO datetime]. */
  moves?: [string, string][];
  /** Days since the last status change (sets status_changed_at). */
  quietDays?: number;
  emails?: { subject: string; excerpt: string; from: string }[];
};

const SEEDS: Seed[] = [
  {
    key: 'northwind',
    companyName: 'Northwind Data',
    roleTitle: 'Full-Stack Engineer (Node/TS/AWS)',
    source: 'linkedin',
    appliedOn: '2026-09-08',
    jd: 'Remote role for a US client. Node.js, TypeScript, React and AWS Lambda. Some overlap with US Eastern hours required.',
    answers: [{ question: 'Are you comfortable working US hours?', answer: 'Yes, I can overlap 4 hours with US Eastern time (until 11 pm IST).' }],
    quietDays: 20,
  },
  {
    key: 'globex',
    companyName: 'Globex',
    roleTitle: 'Platform Engineer',
    source: 'greenhouse',
    appliedOn: '2026-09-12',
    location: 'Pune',
    jd: 'Build our internal platform on AWS (EKS, Terraform). Relocation to Pune supported.',
    notes: 'Panel interview went well; they want a system design round next on scaling queues.',
    moves: [['interview', '2026-09-25T11:00:00+05:30']],
    quietDays: 10,
  },
  {
    key: 'initech',
    companyName: 'Initech',
    roleTitle: 'Backend Developer',
    source: 'linkedin',
    appliedOn: '2026-09-15',
    answers: [{ question: 'What is your notice period?', answer: 'My notice period is 30 days, negotiable to 15.' }],
    moves: [['rejected', '2026-10-02T10:00:00+05:30']],
  },
  {
    key: 'hooli',
    companyName: 'Hooli',
    roleTitle: 'Data Engineer II',
    source: 'naukri',
    appliedOn: '2026-08-28',
    moves: [['interview', '2026-09-20T10:00:00+05:30']],
    emails: [{ subject: 'Onsite round logistics', excerpt: 'The onsite round is at our Bengaluru office on 14 October; please bring a government ID.', from: 'Riya <riya@hooli.example>' }],
  },
  {
    key: 'acme1',
    companyName: 'Acme Robotics',
    roleTitle: 'Backend Engineer',
    source: 'linkedin',
    appliedOn: '2026-09-03',
    quietDays: 30,
  },
  {
    key: 'acme2',
    companyName: 'Acme Robotics',
    roleTitle: 'Data Engineer',
    source: 'greenhouse',
    appliedOn: '2026-10-01',
    moves: [['rejected', '2026-10-04T10:00:00+05:30']],
  },
  {
    key: 'stark',
    companyName: 'Stark Analytics',
    roleTitle: 'Senior Node.js Developer',
    source: 'linkedin',
    appliedOn: '2026-09-22',
    jd: 'Node.js microservices on AWS (SQS, DynamoDB). 5+ years.',
    moves: [['offer', '2026-10-05T10:00:00+05:30']],
  },
  {
    key: 'wayne',
    companyName: 'Wayne Fintech',
    roleTitle: 'Software Engineer',
    source: 'lever',
    appliedOn: '2026-09-18',
    moves: [['assessment', '2026-09-28T10:00:00+05:30']],
    emails: [{ subject: 'Your HackerRank assessment', excerpt: 'Please complete the HackerRank assessment before the deadline of 9 October, 11:59 pm IST.', from: 'Wayne Talent <talent@wayne.example>' }],
  },
  {
    key: 'umbrella',
    companyName: 'Umbrella Health',
    roleTitle: 'DevOps Engineer',
    source: 'linkedin',
    appliedOn: '2026-09-10',
    jd: 'Run our Kubernetes clusters (GKE), Helm charts and CI/CD. On-call rotation.',
    quietDays: 16,
  },
  {
    key: 'vandelay',
    companyName: 'Vandelay Industries',
    roleTitle: 'Full Stack Developer',
    source: 'company_portal',
    appliedOn: '2026-10-03',
    salaryListed: '18–24 LPA',
    jd: 'Stack: Next.js, NestJS, PostgreSQL and Redis. Hybrid in Hyderabad.',
  },
];

const ids: Record<string, string> = {};
let meId: string;

beforeAll(async () => {
  await resetDb();
  meId = (await createUser(db, { email: 'me@example.com', password: PASSWORD })).id;
  const otherId = (await createUser(db, { email: 'other@example.com', password: PASSWORD })).id;
  const login = async (email: string) => {
    const a = request.agent(app);
    await a.post('/api/auth/login').set('Origin', ORIGIN).send({ email, password: PASSWORD }).expect(200);
    return a;
  };
  const me = await login('me@example.com');
  for (const s of SEEDS) {
    const body = { companyName: s.companyName, roleTitle: s.roleTitle, source: s.source, appliedOn: s.appliedOn, status: 'applied', location: s.location, salaryListed: s.salaryListed, notes: s.notes, jd: s.jd };
    const id = (await me.post('/api/applications').set('Origin', ORIGIN).send(body).expect(201)).body.application.id as string;
    ids[s.key] = id;
    if (s.answers) await me.put(`/api/applications/${id}/answers`).set('Origin', ORIGIN).send({ answers: s.answers }).expect(200);
    for (const [status, occurredAt] of s.moves ?? []) await me.post(`/api/applications/${id}/status`).set('Origin', ORIGIN).send({ status, occurredAt }).expect(200);
    if (s.quietDays) await db.update(applications).set({ statusChangedAt: new Date(Date.now() - s.quietDays * DAY) }).where(eq(applications.id, id));
    for (const m of s.emails ?? []) {
      await db.insert(emails).values({
        userId: meId,
        source: 'imap',
        messageId: `<${s.key}-${m.subject}@x>`,
        fromDomain: m.from.split('@')[1]!.replace('>', ''),
        fromEnc: m.from,
        subjectEnc: m.subject,
        excerptEnc: m.excerpt,
        receivedAt: new Date('2026-10-01T10:00:00Z'),
        category: 'interview',
        confidence: 0.8,
        classifiedBy: 'rules',
        outcome: 'applied',
        applicationId: id,
        expiresAt: new Date(Date.now() + 30 * DAY),
      });
    }
  }
  // Another user with look-alike data: must never show up.
  const other = await login('other@example.com');
  await other.post('/api/applications').set('Origin', ORIGIN).send({ companyName: 'Northwind Data', roleTitle: 'SRE', source: 'linkedin', appliedOn: '2026-09-08', status: 'applied', notes: 'OTHER-USER: told them I can work US hours all night', jd: 'OTHER-USER AWS Kubernetes' }).expect(201);
  await db.insert(emails).values({ userId: otherId, source: 'imap', messageId: '<other@x>', fromDomain: 'hooli.example', fromEnc: 'x@hooli.example', subjectEnc: 'Onsite round', excerptEnc: 'OTHER-USER onsite round Bengaluru', receivedAt: new Date(), category: 'interview', confidence: 0.8, classifiedBy: 'rules', outcome: 'unmatched', expiresAt: new Date(Date.now() + DAY) });
}, 60_000);
afterAll(closeDb);

const exact = async (plan: Record<string, unknown>) => runExactQuery(db, meId, planSchema.parse(plan), TZ);
const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const expectIds = (keys: string[]) => keys.map((k) => ids[k]!).sort();

describe('Ask eval: counting and listing (exact database answers)', () => {
  it.each([
    ['How many applications did I send in September?', { kind: 'count', dateField: 'applied', from: '2026-09-01', to: '2026-09-30' }, ['northwind', 'globex', 'initech', 'acme1', 'stark', 'wayne', 'umbrella']],
    ['Which applications from LinkedIn haven’t moved in 2 weeks?', { kind: 'list', sources: ['linkedin'], statuses: ['applied', 'viewed', 'assessment', 'shortlisted', 'interview'], statusUnchangedSince: daysAgo(14) }, ['northwind', 'acme1', 'umbrella']],
    ['Which companies rejected me?', { kind: 'list', reached: ['rejected'] }, ['initech', 'acme2']],
    ['How many interviews have I had?', { kind: 'count', reached: ['interview'] }, ['globex', 'hooli']],
    ['How many rejections this October?', { kind: 'count', reached: ['rejected'], dateField: 'reached', from: '2026-10-01', to: '2026-10-31' }, ['initech', 'acme2']],
    ['Which applications are still waiting to hear back?', { kind: 'list', statuses: ['applied', 'viewed'] }, ['northwind', 'acme1', 'umbrella', 'vandelay']],
    ['Did I get any offers?', { kind: 'list', reached: ['offer'] }, ['stark']],
    ['How many roles did I apply to at Acme?', { kind: 'count', companies: ['Acme'] }, ['acme1', 'acme2']],
    ['Which Greenhouse applications got an interview?', { kind: 'list', sources: ['greenhouse'], reached: ['interview'] }, ['globex']],
    ['What’s waiting on an assessment right now?', { kind: 'list', statuses: ['assessment'] }, ['wayne']],
  ])('%s', async (_q, plan, expected) => {
    const r = await exact(plan);
    expect(idsOf(r.rows)).toEqual(expectIds(expected));
    expect(r.count).toBe(expected.length);
  });

  it('groups exactly (applications by source)', async () => {
    const r = await exact({ kind: 'count', groupBy: 'source' });
    expect(r.groups).toEqual([
      { key: 'LinkedIn', count: 5 },
      { key: 'Greenhouse', count: 2 },
      { key: 'Company portal', count: 1 },
      { key: 'Lever', count: 1 },
      { key: 'Naukri', count: 1 },
    ]);
  });
});

describe('Ask eval: open questions (the right records reach the model)', () => {
  it.each([
    ['What did I tell Northwind about US hours?', ['northwind'], 'overlap 4 hours with US Eastern'],
    ['Which companies asked about AWS?', ['northwind', 'globex', 'stark'], 'AWS'],
    ['What notice period did I mention to Initech?', ['initech'], '30 days, negotiable to 15'],
    ['What did Hooli say about the onsite round?', ['hooli'], 'Bengaluru office on 14 October'],
    ['What’s the tech stack for the Vandelay role?', ['vandelay'], 'NestJS'],
    ['Did any company offer relocation to Pune?', ['globex'], 'Relocation to Pune supported'],
    ['When is the Wayne Fintech assessment deadline?', ['wayne'], '9 October'],
    ['Which role needs Kubernetes?', ['umbrella'], 'Kubernetes clusters'],
    ['What salary range did Vandelay list?', ['vandelay'], '18–24 LPA'],
    ['What did I note about the Globex panel interview?', ['globex'], 'system design round'],
  ])('%s', async (q, expectedApps, mustContain) => {
    const sources = await searchUserData(db, meId, q, { includeEmails: true });
    const apps = new Set(sources.map((s) => s.applicationId));
    for (const k of expectedApps) expect(apps.has(ids[k]!), `${k} in sources`).toBe(true);
    expect(sources.some((s) => s.text.includes(mustContain)), `a source contains “${mustContain}”`).toBe(true);
    expect(sources.every((s) => !s.text.includes('OTHER-USER'))).toBe(true);
  });

  it('emails are searched only when allowed', async () => {
    const off = await searchUserData(db, meId, 'What did Hooli say about the onsite round?', { includeEmails: false });
    expect(off.some((s) => s.type === 'email')).toBe(false);
  });
});
