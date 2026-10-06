import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createApplication } from '../src/applications/service';
import { closeDb, getDb } from '../src/db/client';
import { answerLibrary, applications, profiles, statusEvents } from '../src/db/schema';
import { parseNoticePeriodDays as parseNoticeDays } from '@jt/shared';
import { commitImport, planImport } from '../src/import/service';
import { cleanAppliedVia, mapStatus, parseTrackerWorkbook, toDateOnly } from '../src/import/tracker-xlsx';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

const REAL_FILE = path.resolve(import.meta.dirname, '../../../Job_Applications_Tracker.xlsx');

type Row = [
  ref: number,
  company: string,
  role: string,
  location: string,
  workMode: string,
  exp: string,
  via: string,
  date: Date | string | number | null,
  link: string | null,
  status: string,
];

/** Builds a workbook shaped like my real tracker: title rows, header on row 4, hyperlinks, answers sheet. */
async function buildWorkbook(rows: Row[], answers: Array<[string, string]> = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Applications');
  ws.addRow(['Job Application Tracker – Test']);
  ws.addRow(['Edit the yellow columns…']);
  ws.addRow([]);
  ws.addRow(['#', 'Company', 'Role', 'Location', 'Work Mode', 'Exp Asked', 'Applied Via', 'Date Applied', 'Job Link', 'Status', 'Last Update', 'Follow-up Date', 'Notes / Answers Given']);
  for (const [ref, company, role, location, mode, exp, via, date, link, status] of rows) {
    const r = ws.addRow([ref, company, role, location, mode, exp, via, date, null, status, null, null, `note ${ref}`]);
    if (link) r.getCell(9).value = { text: 'Open ↗', hyperlink: link };
    r.getCell(8).numFmt = 'dd-mmm-yyyy';
  }
  wb.addWorksheet('Summary').addRow(['Summary']);
  const ans = wb.addWorksheet('My Standard Answers');
  ans.addRow(['Standard screening answers']);
  ans.addRow([]);
  for (const a of answers) ans.addRow(a);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const SAMPLE: Row[] = [
  [1, 'Contoso India', 'Node.js Developer', 'Hyderabad', 'On-site', 'Not stated', 'LinkedIn Easy Apply', utcDate(2026, 9, 30), 'https://www.linkedin.com/jobs/view/4100000101/', 'Applied'],
  [2, 'Lumen Browser', 'Backend Platform Engineer', 'Hyderabad', 'On-site (5 days)', '3–5 yrs', 'LinkedIn Easy Apply (by you)', utcDate(2026, 9, 30), 'https://www.linkedin.com/jobs/view/4000000002/', 'Applied'],
  [3, 'Lumen Browser', 'Full-Stack Engineer', 'Hyderabad', 'On-site', '2–6 yrs', 'LinkedIn Easy Apply', utcDate(2026, 9, 30), 'https://www.linkedin.com/jobs/view/4000000003/', 'Applied'],
  [4, 'Northwind Data', 'Senior Software Engineer (Node.js & TypeScript)', 'Remote', 'Remote', '3+ yrs', 'Lever (applied by you)', utcDate(2026, 10, 1), 'https://jobs.lever.co/northwind/0b5a6c1e-1111-2222-3333-444455556666/apply', 'Applied'],
  [5, 'Northwind Data', 'Full-Stack Engineer (Node/TS/AWS)', 'Remote', 'Hybrid (3 days)', '2–4 yrs', 'LinkedIn Easy Apply (by you, earlier)', utcDate(2026, 9, 30), 'https://www.linkedin.com/jobs/view/4000000005/', 'Applied'],
  [6, 'Tessera', 'Software Engineer', 'Bengaluru', 'Hybrid', '1–3 yrs', 'Greenhouse (submitted by you)', utcDate(2026, 10, 2), 'https://job-boards.greenhouse.io/tessera/jobs/8000000102', 'Screening – Shortlisted'],
  [7, 'NoLink Corp', 'Backend Developer', 'Pune', 'On-site', '2+ yrs', 'Company portal', '01/10/2026', null, 'Applied'],
];

const ANSWERS: Array<[string, string]> = [
  ['Total experience', '3 years'],
  ['Node.js', '3 years'],
  ['Notice period', 'Immediate (0 days)'],
  ['Current CTC', '6 LPA (600000)'],
  ['Expected CTC', '14 LPA (1400000)'],
  ['Relocation', 'Yes (Hyderabad preferred)'],
  ['Current location', 'Indore, Madhya Pradesh 452001'],
];

describe('parsing helpers', () => {
  it('reads dates as date-only with no time-zone shift', () => {
    expect(toDateOnly(utcDate(2026, 9, 30))).toBe('2026-09-30');
    // floating-point noise in a serial still lands on the right day
    expect(toDateOnly(new Date(Date.UTC(2026, 8, 30) - 10_000))).toBe('2026-09-30');
    expect(toDateOnly(46295)).toBe('2026-09-30'); // raw Excel serial
    expect(toDateOnly('30-Sep-2026')).toBe('2026-09-30');
    expect(toDateOnly('30/09/2026')).toBe('2026-09-30'); // day-first (India)
    expect(toDateOnly('2026-09-30')).toBe('2026-09-30');
    expect(toDateOnly('31/02/2026')).toBe('invalid');
    expect(toDateOnly(null)).toBeNull();
  });

  it.each([
    ['LinkedIn Easy Apply (by you)', 'LinkedIn Easy Apply'],
    ['Lever (applied by you)', 'Lever'],
    ['Lever (submitted by you)', 'Lever'],
    ['Greenhouse (by you)', 'Greenhouse'],
    ['LinkedIn Easy Apply (by you, earlier)', 'LinkedIn Easy Apply'],
    ['Greenhouse', 'Greenhouse'],
  ])('cleans "%s" → "%s"', (raw, clean) => {
    expect(cleanAppliedVia(raw)).toBe(clean);
  });

  it('maps status labels', () => {
    expect(mapStatus('Applied')).toBe('applied');
    expect(mapStatus('Screening – Shortlisted')).toBe('shortlisted');
    expect(mapStatus('No response')).toBe('ghosted');
    expect(mapStatus('Something odd')).toBeNull();
  });

  it('parses notice periods', () => {
    expect(parseNoticeDays('Immediate (0 days)')).toBe(0);
    expect(parseNoticeDays('30 days')).toBe(30);
    expect(parseNoticeDays('2 months')).toBe(60);
  });
});

describe('parseTrackerWorkbook (synthetic file)', () => {
  it('maps every column, reading link targets rather than "Open ↗"', async () => {
    const parsed = await parseTrackerWorkbook(await buildWorkbook(SAMPLE, ANSWERS));
    expect(parsed.applications).toHaveLength(7);
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);

    const [contoso, lumen, , northwind, northwind2, tessera, nolink] = parsed.applications;
    expect(contoso).toMatchObject({
      ref: '1',
      companyName: 'Contoso India',
      appliedOn: '2026-09-30',
      jobUrl: 'https://www.linkedin.com/jobs/view/4100000101/',
      source: 'linkedin',
      sourceDetail: 'LinkedIn Easy Apply',
      workMode: 'onsite',
      workModeDetail: null,
      experienceAsked: null, // "Not stated"
      status: 'applied',
      notes: 'note 1',
    });
    expect(lumen).toMatchObject({ sourceDetail: 'LinkedIn Easy Apply', workMode: 'onsite', workModeDetail: 'On-site (5 days)', experienceAsked: '3–5 yrs' });
    expect(northwind).toMatchObject({ source: 'lever', sourceDetail: 'Lever' });
    expect(northwind2).toMatchObject({ sourceDetail: 'LinkedIn Easy Apply', workMode: 'hybrid', workModeDetail: 'Hybrid (3 days)' });
    expect(tessera).toMatchObject({ source: 'greenhouse', sourceDetail: 'Greenhouse', status: 'shortlisted', appliedOn: '2026-10-02' });
    expect(nolink).toMatchObject({ source: 'company_portal', jobUrl: null, appliedOn: '2026-10-01' });
    expect(parsed.answers.map((a) => a.question)).toEqual(ANSWERS.map(([q]) => q));
  });

  it('"Applied Via" decides the source; a different link host is kept as-is and reported', async () => {
    // Like #34 G-P: applied through Greenhouse, but the saved link is the LinkedIn listing.
    const parsed = await parseTrackerWorkbook(
      await buildWorkbook([
        [34, 'W-G (Worldwide Group)', 'Software Engineer II', 'Remote', 'Remote', '', 'Greenhouse', utcDate(2026, 10, 2), 'https://www.linkedin.com/jobs/view/4100000102/', 'Applied'],
        [35, 'Easy Co', 'Developer', 'Remote', 'Remote', '', 'LinkedIn Easy Apply', utcDate(2026, 10, 2), 'https://job-boards.greenhouse.io/easyco/jobs/123', 'Applied'],
        [36, 'Agree Co', 'Developer', 'Remote', 'Remote', '', 'Greenhouse', utcDate(2026, 10, 2), 'https://job-boards.greenhouse.io/agreeco/jobs/456', 'Applied'],
      ]),
    );
    const [gp, easy, agree] = parsed.applications;
    expect(gp).toMatchObject({ source: 'greenhouse', jobUrl: 'https://www.linkedin.com/jobs/view/4100000102/' });
    expect(easy).toMatchObject({ source: 'linkedin', jobUrl: 'https://job-boards.greenhouse.io/easyco/jobs/123' });
    expect(agree).toMatchObject({ source: 'greenhouse' });

    const warnings = parsed.issues.filter((i) => i.field === 'Applied Via');
    expect(warnings.map((w) => w.ref)).toEqual(['34', '35']);
    expect(warnings[0]).toMatchObject({ severity: 'warning', message: 'Applied via Greenhouse but the link is a LinkedIn posting; kept Greenhouse' });
  });

  it('reports problem rows instead of failing', async () => {
    const parsed = await parseTrackerWorkbook(
      await buildWorkbook([
        [1, 'Good Co', 'Developer', 'Pune', 'Remote', '', 'LinkedIn', utcDate(2026, 9, 30), 'https://www.linkedin.com/jobs/view/111111111/', 'Applied'],
        [2, 'No Role Co', '', 'Pune', 'Remote', '', 'LinkedIn', utcDate(2026, 9, 30), null, 'Applied'],
        [3, 'Odd Co', 'Developer', 'Pune', 'Remote', '', 'Carrier pigeon', 'someday', 'mailto:hr@odd.co', 'Maybe?'],
      ]),
    );
    expect(parsed.applications.map((a) => a.companyName)).toEqual(['Good Co', 'Odd Co']);
    const byRef = (ref: string) => parsed.issues.filter((i) => i.ref === ref).map((i) => `${i.severity}:${i.field}`);
    expect(byRef('2')).toEqual(['error:Role']);
    expect(byRef('3').sort()).toEqual(['warning:Applied Via', 'warning:Date Applied', 'warning:Job Link', 'warning:Status'].sort());
    expect(parsed.applications[1]).toMatchObject({ source: 'other', status: 'applied', appliedOn: null, jobUrl: null });
  });
});

describe.runIf(existsSync(REAL_FILE))('my real tracker file', () => {
  // Your own file stays on your machine; these checks name rows by number only (no real data in the repo).
  it('reads the known dates exactly: rows #1, #25 and #39', async () => {
    const parsed = await parseTrackerWorkbook(await readFile(REAL_FILE));
    const byRef = (ref: string) => parsed.applications.find((a) => a.ref === ref)!;
    expect(byRef('1')).toMatchObject({ appliedOn: '2026-09-30' });
    expect(byRef('25')).toMatchObject({ appliedOn: '2026-10-02' });
    expect(byRef('39')).toMatchObject({ appliedOn: '2026-09-30', sourceDetail: 'LinkedIn Easy Apply' });
  });

  it('classifies sources by "Applied Via": 34 LinkedIn, 4 Greenhouse, 2 Lever', async () => {
    const parsed = await parseTrackerWorkbook(await readFile(REAL_FILE));
    const count = (s: string) => parsed.applications.filter((a) => a.source === s).length;
    expect({ linkedin: count('linkedin'), greenhouse: count('greenhouse'), lever: count('lever') }).toEqual({ linkedin: 34, greenhouse: 4, lever: 2 });
  });

  it('parses all 40 rows with real links and no errors', async () => {
    const parsed = await parseTrackerWorkbook(await readFile(REAL_FILE));
    expect(parsed.applications).toHaveLength(40);
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(parsed.applications.every((a) => a.jobUrl?.startsWith('https://'))).toBe(true);
    expect(parsed.applications.some((a) => /by you/i.test(a.sourceDetail ?? ''))).toBe(false);
  });
});

describe('import into the database', () => {
  const db = getDb();
  let userId: string;

  beforeEach(async () => {
    await resetDb();
    userId = (await createUser(db, { email: 'asha@example.com', password: 'correct horse battery' })).id;
  });
  afterAll(closeDb);

  it('dry run reports counts and writes nothing', async () => {
    const parsed = await parseTrackerWorkbook(await buildWorkbook(SAMPLE, ANSWERS));
    const plan = await planImport(db, userId, parsed);
    expect(plan.summary).toMatchObject({ rows: 7, create: 7, exists: 0, possibleDuplicates: 0, errors: 0 });
    expect(await db.select().from(applications)).toHaveLength(0);
    expect(await db.select().from(answerLibrary)).toHaveLength(0);
  });

  it('imports rows with one "import" timeline event dated by Date Applied', async () => {
    const parsed = await parseTrackerWorkbook(await buildWorkbook(SAMPLE, ANSWERS));
    await commitImport(db, userId, parsed, 'tracker.xlsx');

    const apps = await db.select().from(applications);
    expect(apps).toHaveLength(7);
    const contoso = apps.find((a) => a.roleTitle === 'Node.js Developer')!;
    expect(contoso).toMatchObject({
      appliedOn: '2026-09-30',
      status: 'applied',
      jobUrlCanonical: 'https://www.linkedin.com/jobs/view/4100000101/',
      externalJobId: '4100000101',
      importKey: 'url:https://www.linkedin.com/jobs/view/4100000101/',
    });

    const events = await db.select().from(statusEvents).where(eq(statusEvents.applicationId, contoso.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'import', fromStatus: null, toStatus: 'applied', disposition: 'applied' });
    expect(events[0]!.occurredAt.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(events[0]!.note).toBe('Imported from tracker.xlsx, row #1');

    // Exactly one event per imported row, all from "import"
    const all = await db.select().from(statusEvents);
    expect(all).toHaveLength(7);
    expect(all.every((e) => e.source === 'import')).toBe(true);
  });

  it('re-running creates zero duplicates', async () => {
    const parsed = await parseTrackerWorkbook(await buildWorkbook(SAMPLE, ANSWERS));
    await commitImport(db, userId, parsed, 'tracker.xlsx');
    const second = await commitImport(db, userId, parsed, 'tracker.xlsx');

    expect(second.summary).toMatchObject({ create: 0, exists: 7, libraryCreate: 0, profileFields: 0 });
    expect(second.answers.profile.every((p) => p.action === 'already_set')).toBe(true);
    expect(await db.select().from(applications)).toHaveLength(7);
    expect(await db.select().from(statusEvents)).toHaveLength(7);
    expect((await db.select().from(answerLibrary)).length).toBe(1); // only "Node.js"; the rest live on the profile
  });

  it('imports Lumen Browser and Northwind Data role pairs as separate applications', async () => {
    const parsed = await parseTrackerWorkbook(await buildWorkbook(SAMPLE));
    const plan = await commitImport(db, userId, parsed, 'tracker.xlsx');
    expect(plan.rows.filter((r) => r.row.companyName === 'Lumen Browser').map((r) => r.action)).toEqual(['create', 'create']);
    expect(plan.rows.filter((r) => r.row.companyName === 'Northwind Data').map((r) => r.action)).toEqual(['create', 'create']);
  });

  it('matches applications that were added before the import (same job URL) instead of duplicating', async () => {
    await createApplication(
      db,
      userId,
      { companyName: 'Contoso', roleTitle: 'Lead Node.js developer', jobUrl: 'https://in.linkedin.com/jobs/view/4100000101?trk=x', status: 'applied', via: 'manual', confirmDuplicate: false },
      'extension',
    );
    const plan = await planImport(db, userId, await parseTrackerWorkbook(await buildWorkbook(SAMPLE)));
    expect(plan.rows[0]).toMatchObject({ action: 'exists' });
    expect(plan.summary.create).toBe(6);
  });

  it('flags likely duplicates of manually-added applications and skips them', async () => {
    await createApplication(db, userId, { companyName: 'NoLink Corp Pvt Ltd', roleTitle: 'Backend Developer', status: 'applied', via: 'manual', confirmDuplicate: false }, 'manual');
    const plan = await commitImport(db, userId, await parseTrackerWorkbook(await buildWorkbook(SAMPLE)), 'tracker.xlsx');
    const row = plan.rows.find((r) => r.row.companyName === 'NoLink Corp')!;
    expect(row.action).toBe('possible_duplicate');
    expect(row.match?.label).toContain('NoLink Corp Pvt Ltd');
    expect(await db.select().from(applications)).toHaveLength(7); // 1 manual + 6 imported
  });

  it('reports duplicate rows inside the same file', async () => {
    const plan = await planImport(db, userId, await parseTrackerWorkbook(await buildWorkbook([SAMPLE[0]!, [99, ...SAMPLE[0]!.slice(1)] as Row])));
    expect(plan.rows.map((r) => r.action)).toEqual(['create', 'duplicate_in_file']);
  });

  it('profile facts go to the profile only (CTC encrypted); everything else to the answer library', async () => {
    const plan = await commitImport(db, userId, await parseTrackerWorkbook(await buildWorkbook([], ANSWERS)), 'tracker.xlsx');
    const library = await db.select().from(answerLibrary);
    // No copies of profile facts in the library table
    expect(library.map((l) => l.question)).toEqual(['Node.js']);
    expect(JSON.stringify(library)).not.toMatch(/LPA|Immediate|Indore/);

    const [profile] = await db.select().from(profiles);
    expect(profile).toMatchObject({
      currentCtcEnc: '6 LPA (600000)',
      expectedCtcEnc: '14 LPA (1400000)',
      noticePeriodDays: 0,
      relocationWilling: true,
      relocationPreference: 'Hyderabad preferred',
      currentLocation: 'Indore, Madhya Pradesh 452001',
      totalExperienceYears: '3.0',
    });
    const raw = await db.execute<{ current_ctc_enc: string }>(sql`select current_ctc_enc from profiles`);
    expect(raw.rows[0]!.current_ctc_enc).toMatch(/^v1\./);
    expect(plan.summary.profileFields).toBe(6);
  });

  it('API: dry run by default, commit with ?commit=true, session only', async () => {
    const app = createApp({ db });
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'asha@example.com', password: 'correct horse battery' }).expect(200);
    const file = await buildWorkbook(SAMPLE, ANSWERS);
    const upload = (q = '') => agent.post(`/api/import/tracker-xlsx${q}`).set('Origin', ORIGIN).set('Content-Type', 'application/octet-stream').send(file);

    const preview = await upload();
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ committed: false, summary: { create: 7 } });
    expect(await db.select().from(applications)).toHaveLength(0);

    const committed = await upload('?commit=true&fileName=Job_Applications_Tracker.xlsx');
    expect(committed.body).toMatchObject({ committed: true, summary: { create: 7 } });
    expect((await upload('?commit=true')).body.summary).toMatchObject({ create: 0, exists: 7 });

    const garbage = await agent.post('/api/import/tracker-xlsx').set('Origin', ORIGIN).set('Content-Type', 'application/octet-stream').send(Buffer.from('not a workbook'));
    expect(garbage.status).toBe(400);

    const { token } = (await agent.post('/api/auth/tokens').set('Origin', ORIGIN).send({ name: 'ext' })).body.token;
    const viaToken = await request(app).post('/api/import/tracker-xlsx').set('Authorization', `Bearer ${token}`).set('X-JT-Intent', 'user').send(file);
    expect(viaToken.status).toBe(403);
  });
});
