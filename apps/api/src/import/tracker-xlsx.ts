import {
  APPLICATION_STATUSES,
  canonicalJobUrl,
  type ApplicationSource,
  type ApplicationStatus,
  type WorkMode,
} from '@jt/shared';
import ExcelJS from 'exceljs';

/**
 * Parser for my personal tracker workbook (sheets: "Applications", "My Standard Answers";
 * "Summary" is formulas only and ignored). Pure: no DB access, so it is unit-testable.
 */

export interface ImportIssue {
  sheet: string;
  sheetRow: number;
  ref: string | null; // the "#" column, e.g. "12"
  field: string | null;
  severity: 'error' | 'warning';
  message: string;
}

export interface ParsedApplicationRow {
  sheetRow: number;
  ref: string | null;
  companyName: string;
  roleTitle: string;
  location: string | null;
  workMode: WorkMode;
  workModeDetail: string | null;
  experienceAsked: string | null;
  source: ApplicationSource;
  sourceDetail: string | null;
  appliedOn: string | null; // YYYY-MM-DD, never time-zone shifted
  jobUrl: string | null;
  status: ApplicationStatus;
  lastUpdateOn: string | null;
  followUpOn: string | null;
  notes: string | null;
}

export interface ParsedAnswer {
  sheetRow: number;
  question: string;
  answer: string;
}

export interface ParsedWorkbook {
  applications: ParsedApplicationRow[];
  answers: ParsedAnswer[];
  issues: ImportIssue[];
}

const APPLICATIONS_SHEET = /^applications?$/i;
const ANSWERS_SHEET = /standard answers/i;

type Column =
  | 'ref'
  | 'company'
  | 'role'
  | 'location'
  | 'workMode'
  | 'experience'
  | 'appliedVia'
  | 'dateApplied'
  | 'jobLink'
  | 'status'
  | 'lastUpdate'
  | 'followUp'
  | 'notes';

const HEADER_MATCHERS: Array<[Column, RegExp]> = [
  ['ref', /^(#|no\.?|sr\.? ?no\.?)$/],
  ['company', /^company/],
  ['role', /^(role|position|title|job title)/],
  ['location', /^(location|city)/],
  ['workMode', /^work ?mode/],
  ['experience', /^exp/],
  ['appliedVia', /^(applied via|source|platform)/],
  ['dateApplied', /^(date applied|applied on|applied date)/],
  ['jobLink', /^(job link|link|url|job url)/],
  ['status', /^status/],
  ['lastUpdate', /^last update/],
  ['followUp', /^follow[- ]?up/],
  ['notes', /^notes/],
];

const DAY_MS = 86_400_000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ---------------------------------------------------------------- cell helpers

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('').trim();
  if (typeof v === 'object' && 'text' in v) return String(v.text ?? '').trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/**
 * Date-only value with no time-zone shift. exceljs maps a date serial to UTC
 * midnight, so the UTC calendar date *is* the sheet's date. Rounding to the
 * nearest day absorbs floating-point noise in the serial.
 */
export function toDateOnly(value: ExcelJS.CellValue): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return 'invalid';
    return new Date(Math.round(value.getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * DAY_MS).toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && 'result' in value) return toDateOnly(value.result as ExcelJS.CellValue);
  const text = typeof value === 'object' && 'text' in value ? String(value.text) : String(value);
  return parseDateText(text.trim());
}

function parseDateText(text: string): string | null | 'invalid' {
  if (!text || /^(-|n\/?a|none)$/i.test(text)) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  // India: day first
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return ymd(+m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s,-]+(\d{4})$/i.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    if (month) return ymd(+m[3]!, month, +m[1]!);
  }
  return 'invalid';
}

function ymd(y: number, m: number, d: number): string | 'invalid' {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return 'invalid';
  return date.toISOString().slice(0, 10);
}

/** The link target, never the display text ("Open ↗"). */
export function hyperlinkOf(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v && typeof v === 'object') {
    if ('hyperlink' in v && v.hyperlink) return String(v.hyperlink).trim();
    if ('formula' in v && v.formula) {
      const m = /HYPERLINK\(\s*"([^"]+)"/i.exec(String(v.formula));
      if (m) return m[1]!.trim();
    }
  }
  if (cell.hyperlink) return cell.hyperlink.trim();
  const text = cellText(cell);
  return /^https?:\/\//i.test(text) ? text : null;
}

// ---------------------------------------------------------------- field mappers

/** "LinkedIn Easy Apply (by you, earlier)" → "LinkedIn Easy Apply" */
export function cleanAppliedVia(raw: string): string {
  return raw
    .replace(/\s*\((?:applied |submitted )?by you(?:,\s*earlier)?\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mapSource(label: string): ApplicationSource | null {
  const l = label.toLowerCase();
  if (l.includes('linkedin')) return 'linkedin';
  if (l.includes('naukri')) return 'naukri';
  if (l.includes('greenhouse')) return 'greenhouse';
  if (l.includes('lever')) return 'lever';
  if (l.includes('workday')) return 'workday';
  if (l.includes('referr')) return 'referral';
  if (/\b(portal|careers?|company site|website)\b/.test(l)) return 'company_portal';
  if (l.includes('email')) return 'email';
  return null;
}

export function mapWorkMode(raw: string): { mode: WorkMode; detail: string | null } {
  const l = raw.toLowerCase();
  const mode: WorkMode = l.includes('remote')
    ? 'remote'
    : l.includes('hybrid')
      ? 'hybrid'
      : /on-?site|office|wfo/.test(l)
        ? 'onsite'
        : 'unknown';
  // Keep the original only when it carries more than the mode itself, e.g. "Hybrid (3 days)".
  const detail = raw && !/^(remote|hybrid|on-?site|onsite)$/i.test(raw.trim()) ? raw.trim() : null;
  return { mode, detail };
}

const STATUS_ALIASES: Record<string, ApplicationStatus> = {
  'to apply': 'saved',
  wishlist: 'saved',
  submitted: 'applied',
  'application viewed': 'viewed',
  'in review': 'viewed',
  'under review': 'viewed',
  test: 'assessment',
  'online test': 'assessment',
  assignment: 'assessment',
  screening: 'shortlisted',
  'screening shortlisted': 'shortlisted',
  'hr round': 'interview',
  'technical round': 'interview',
  interviewing: 'interview',
  'not selected': 'rejected',
  declined: 'rejected',
  'no response': 'ghosted',
};

export function mapStatus(raw: string): ApplicationStatus | null {
  const key = raw
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return null;
  if ((APPLICATION_STATUSES as readonly string[]).includes(key)) return key as ApplicationStatus;
  return STATUS_ALIASES[key] ?? null;
}

const nullIfPlaceholder = (v: string) => (!v || /^(not stated|n\/?a|-|none)$/i.test(v) ? null : v);

// ---------------------------------------------------------------- sheets

function findHeader(ws: ExcelJS.Worksheet): { row: number; columns: Partial<Record<Column, number>> } | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const columns: Partial<Record<Column, number>> = {};
    ws.getRow(r).eachCell((cell, col) => {
      const h = cellText(cell).toLowerCase().replace(/\s+/g, ' ');
      const match = HEADER_MATCHERS.find(([, re]) => re.test(h));
      if (match && columns[match[0]] === undefined) columns[match[0]] = col;
    });
    if (columns.company && columns.role) return { row: r, columns };
  }
  return null;
}

function parseApplications(ws: ExcelJS.Worksheet, issues: ImportIssue[]): ParsedApplicationRow[] {
  const header = findHeader(ws);
  if (!header) {
    issues.push({ sheet: ws.name, sheetRow: 0, ref: null, field: null, severity: 'error', message: 'Header row with "Company" and "Role" not found' });
    return [];
  }
  const { columns } = header;
  const rows: ParsedApplicationRow[] = [];

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (c: Column) => (columns[c] ? row.getCell(columns[c]) : undefined);
    const text = (c: Column) => {
      const cell = get(c);
      return cell ? cellText(cell) : '';
    };

    const companyName = text('company');
    const roleTitle = text('role');
    if (!companyName && !roleTitle) continue; // blank / trailing row

    const ref = text('ref') || null;
    const issue = (field: string | null, severity: ImportIssue['severity'], message: string) =>
      issues.push({ sheet: ws.name, sheetRow: r, ref, field, severity, message });

    if (!companyName || !roleTitle) {
      issue(companyName ? 'Role' : 'Company', 'error', `Missing ${companyName ? 'role' : 'company'}`);
      continue;
    }

    const date = (c: Column, label: string) => {
      const cell = get(c);
      const value = cell ? toDateOnly(cell.value) : null;
      if (value === 'invalid') {
        issue(label, 'warning', `Unreadable date "${cell ? cellText(cell) : ''}"`);
        return null;
      }
      return value;
    };

    const viaRaw = text('appliedVia');
    const via = cleanAppliedVia(viaRaw);
    const linkCell = get('jobLink');
    const jobUrl = linkCell ? hyperlinkOf(linkCell) : null;
    const canonical = canonicalJobUrl(jobUrl);
    if (linkCell && cellText(linkCell) && !canonical) {
      issue('Job Link', 'warning', 'Job link is not a web URL; imported without a link');
    }

    let source = mapSource(via) ?? canonical?.source ?? null;
    if (!source) {
      if (via) issue('Applied Via', 'warning', `Unrecognised platform "${via}"; saved as Other`);
      source = 'other';
    }

    const statusRaw = text('status');
    let status = mapStatus(statusRaw);
    if (!status) {
      issue('Status', 'warning', statusRaw ? `Unknown status "${statusRaw}"; imported as Applied` : 'No status; imported as Applied');
      status = 'applied';
    }

    const appliedCell = get('dateApplied');
    const appliedOn = date('dateApplied', 'Date Applied');
    if (!appliedOn && status !== 'saved' && !(appliedCell && cellText(appliedCell))) {
      issue('Date Applied', 'warning', 'No applied date');
    }

    const workMode = mapWorkMode(text('workMode'));

    rows.push({
      sheetRow: r,
      ref,
      companyName,
      roleTitle,
      location: text('location') || null,
      workMode: workMode.mode,
      workModeDetail: workMode.detail,
      experienceAsked: nullIfPlaceholder(text('experience')),
      source,
      sourceDetail: via || null,
      appliedOn,
      jobUrl: canonical ? jobUrl : null,
      status,
      lastUpdateOn: date('lastUpdate', 'Last Update'),
      followUpOn: date('followUp', 'Follow-up Date'),
      notes: text('notes') || null,
    });
  }
  return rows;
}

function parseAnswers(ws: ExcelJS.Worksheet): ParsedAnswer[] {
  const answers: ParsedAnswer[] = [];
  ws.eachRow((row, r) => {
    const question = cellText(row.getCell(1));
    const answer = cellText(row.getCell(2));
    // Title rows have no answer column; skip them and any header-like row.
    if (!question || !answer || /^(question|field)$/i.test(question)) return;
    answers.push({ sheetRow: r, question, answer });
  });
  return answers;
}

export async function parseTrackerWorkbook(data: ArrayBuffer | Uint8Array): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

  const issues: ImportIssue[] = [];
  const appsSheet = wb.worksheets.find((w) => APPLICATIONS_SHEET.test(w.name.trim())) ?? wb.worksheets.find((w) => findHeader(w));
  const answersSheet = wb.worksheets.find((w) => ANSWERS_SHEET.test(w.name));

  if (!appsSheet) {
    issues.push({ sheet: '', sheetRow: 0, ref: null, field: null, severity: 'error', message: 'No "Applications" sheet found' });
  }
  return {
    applications: appsSheet ? parseApplications(appsSheet, issues) : [],
    answers: answersSheet ? parseAnswers(answersSheet) : [],
    issues,
  };
}
