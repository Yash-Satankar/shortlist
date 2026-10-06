import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { E2E_USER } from '../playwright.config';

/** Runs on a phone and a desktop viewport; names carry the project so both runs share one database. */
const tag = () => (test.info().project.name === 'phone' ? 'Ph' : 'Dk');

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(E2E_USER.email);
  await page.locator('input[type=password]').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
}

/** The API with the page's session, as the web app calls it (same origin). */
const api = (page: Page) => ({
  post: async (path: string, data: unknown) => {
    const res = await page.request.post(`/api${path}`, { data, headers: { Origin: new URL(page.url()).origin } });
    expect(res.ok(), `${path} → ${res.status()}`).toBe(true);
    return res.json();
  },
});

test('login: a wrong password is refused, the right one opens Applications', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(E2E_USER.email);
  await page.locator('input[type=password]').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('input[type=password]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('heading', { name: 'Applications' })).toHaveCount(0);
  await login(page);
});

test('quick-add from a share link: prefilled, saved as Applied, in the list', async ({ page }) => {
  await login(page);
  const company = `Initech ${tag()}`;
  const url = `https://www.linkedin.com/jobs/view/${tag() === 'Ph' ? '4190000001' : '4190000002'}/`;
  await page.goto(`/share?title=${encodeURIComponent(`${company} hiring Backend Engineer in Pune, Maharashtra, India | LinkedIn`)}&url=${encodeURIComponent(url)}`);
  await expect(page.getByRole('textbox', { name: /^Company/ })).toHaveValue(company);
  await expect(page.getByRole('textbox', { name: /^Role/ })).toHaveValue('Backend Engineer');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByText(`Saved ${company}`)).toBeVisible();
  await page.goto('/');
  await expect(page.getByText(company).first()).toBeVisible();
});

test('status change, then undo: back to the previous status, both on the timeline', async ({ page }) => {
  await login(page);
  const company = `Globex ${tag()}`;
  const { application } = await api(page).post('/applications', { companyName: company, roleTitle: 'SRE', status: 'applied' });
  await page.goto(`/applications/${application.id}`);
  await page.getByRole('button', { name: /Change status/ }).first().click();
  await page.getByRole('dialog', { name: 'Change status' }).getByRole('button', { name: /^Interview/ }).click();
  await expect(page.getByRole('button', { name: /Status: Interview/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /Status: Applied/ }).first()).toBeVisible();
  await expect(page.getByText('Undone', { exact: true })).toBeVisible();
});

test('follow-up snooze: a due follow-up leaves the inbox for 7 days', async ({ page }) => {
  await login(page);
  const company = `Hooli ${tag()}`;
  await api(page).post('/applications', { companyName: company, roleTitle: 'Data Engineer', status: 'applied', followUpOn: '2026-01-01' });
  await page.goto('/follow-ups');
  const link = page.getByRole('link', { name: new RegExp(company) });
  await expect(link).toBeVisible();
  // The card: the innermost element holding both this application's link and its snooze button.
  const card = page.locator('div', { has: link }).filter({ has: page.getByRole('button', { name: /snooze 7d/ }) }).last();
  await card.getByRole('button', { name: /Followed up · snooze 7d/ }).click();
  await expect(link).toHaveCount(0);
});

test('import dry run: reports what would be imported and writes nothing', async ({ page }) => {
  await login(page);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Applications');
  ws.addRow(['Job Application Tracker']);
  ws.addRow([]);
  ws.addRow([]);
  ws.addRow(['#', 'Company', 'Role', 'Location', 'Work Mode', 'Exp Asked', 'Applied Via', 'Date Applied', 'Job Link', 'Status', 'Last Update', 'Follow-up Date', 'Notes / Answers Given']);
  ws.addRow([1, `Vandelay ${tag()}`, 'Importer', 'Remote', 'Remote', '2+ yrs', 'LinkedIn Easy Apply', '01/10/2026', null, 'Applied']);
  ws.addRow([2, `Umbrella ${tag()}`, 'DevOps Engineer', 'Pune', 'On-site', '3+ yrs', 'Company portal', '02/10/2026', null, 'Applied']);
  const body = Buffer.from(await wb.xlsx.writeBuffer());
  const before = await (await page.request.get('/api/applications?limit=500')).json();
  const res = await page.request.post('/api/import/tracker-xlsx', { data: body, headers: { Origin: new URL(page.url()).origin, 'Content-Type': 'application/octet-stream' } });
  expect(res.ok()).toBe(true);
  const plan = await res.json();
  expect(plan.committed).toBe(false);
  expect(JSON.stringify(plan)).toContain(`Vandelay ${tag()}`);
  const after = await (await page.request.get('/api/applications?limit=500')).json();
  expect(after.total).toBe(before.total);
});
