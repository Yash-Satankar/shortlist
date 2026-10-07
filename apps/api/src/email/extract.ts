import { canonicalJobUrl, type ApplicationSource } from '@jt/shared';
import { domainOf, type RawEmail } from './sources';

/**
 * What an email says about the job it's about: company, role, location and the job's link,
 * read from the portal's own confirmation wording ("Your application was sent to Alaan",
 * "Thanks for applying to the Backend Engineer role at Acme"). Used to create the application
 * for a confirmation email that matches nothing you track, and to pre-fill "Create new
 * application" on any unmatched email. Never guesses: every field comes from an explicit pattern.
 */
export interface ExtractedJob {
  companyName: string | null;
  roleTitle: string | null;
  location: string | null;
  jobUrl: string | null;
  /** The portal / ATS that sent it (null: an employer's own address). */
  portal: Portal | null;
  /** How sure the extraction is: 0.9 role and company in one phrase, 0.85 company from the subject, 0.75 company only from the sender's name, 0 incomplete. */
  confidence: number;
}

export type Portal = 'linkedin' | 'naukri' | 'greenhouse' | 'lever' | 'workday' | 'smartrecruiters' | 'ashby' | 'successfactors';

const PORTAL_DOMAINS: [RegExp, Portal][] = [
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)naukri\.com$/, 'naukri'],
  [/(^|\.)greenhouse(-mail)?\.io$/, 'greenhouse'],
  [/(^|\.)lever\.co$/, 'lever'],
  [/(^|\.)(myworkday|workday|myworkdayjobs)\.com$/, 'workday'],
  [/(^|\.)smartrecruiters\.com$/, 'smartrecruiters'],
  [/(^|\.)ashbyhq\.com$/, 'ashby'],
  [/(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu)|sap\.com)$/, 'successfactors'],
];

export const PORTAL_SOURCE: Record<Portal, ApplicationSource> = {
  linkedin: 'linkedin',
  naukri: 'naukri',
  greenhouse: 'greenhouse',
  lever: 'lever',
  workday: 'workday',
  smartrecruiters: 'company_portal',
  ashby: 'company_portal',
  successfactors: 'company_portal',
};

export const PORTAL_LABEL: Record<Portal, string> = {
  linkedin: 'LinkedIn',
  naukri: 'Naukri',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workday: 'Workday',
  smartrecruiters: 'SmartRecruiters',
  ashby: 'Ashby',
  successfactors: 'SuccessFactors',
};

export const portalOf = (domain: string): Portal | null => PORTAL_DOMAINS.find(([r]) => r.test(domain))?.[1] ?? null;

/** Names that are the portal, not the employer. */
const NOT_A_COMPANY = /^(linkedin|naukri(\.com)?|greenhouse|lever|workday|smartrecruiters|ashby|successfactors|sap|no-?reply|notifications?|jobs|careers|recruiting|talent|hiring|team|the team|us|you)$/i;

const clean = (s: string | undefined | null) =>
  (s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“‘]+|[\s"'”’.,!:;-]+$/g, '')
    .trim();

/** Strip requisition ids and noise from a role: "Backend Engineer (R-12345)", "Backend Engineer - Job ID 123". */
const cleanRole = (s: string | undefined | null) =>
  clean(s)
    .replace(/\s*[([]\s*(?:req(?:uisition)?|job)?\s*(?:id|#|no\.?)?\s*:?\s*[A-Z]{0,4}-?\d[\w-]*\s*[)\]]$/i, '')
    .replace(/\s*[-–—|]\s*(?:req(?:uisition)?|job)\s*(?:id|#|no\.?)?\s*:?\s*[\w-]*\d[\w-]*$/i, '')
    .replace(/\s*\b[A-Z]{1,3}-?\d{4,}\s*$/, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+(?:position|role|job|opening|opportunity)$/i, '')
    .trim();

const cleanCompany = (s: string | undefined | null) =>
  clean(s)
    .replace(/\s+(?:hiring|recruiting|talent(?: acquisition)?|careers?|people|hr)(?:\s+team)?$/i, '')
    .replace(/\s+team$/i, '')
    .trim();

const plausibleRole = (s: string) => s.length >= 2 && s.length <= 120 && !/https?:|@|\bapplication\b|\bthank/i.test(s) && /[a-z]/i.test(s);
const plausibleCompany = (s: string) => s.length >= 2 && s.length <= 80 && !/https?:|@/.test(s) && !NOT_A_COMPANY.test(s) && /[a-z0-9]/i.test(s);

/** Explicit "<role> at <company>" wordings, in order of reliability. */
const ROLE_AT_COMPANY: RegExp[] = [
  /\b(?:applying|applied|application|apply)\s+(?:for|to)\s+the\s+(?:position|role|job)\s+of\s+(?<role>.{2,120}?)\s+(?:at|with)\s+(?<co>[^\n.!,;]{2,80})/i,
  /\b(?:applying|applied|application|apply)\s+(?:for|to)\s+the\s+(?<role>.{2,120}?)\s+(?:position|role|job|opening|opportunity)(?:\s*\([^)]*\))?\s+(?:at|with)\s+(?<co>[^\n.!,;]{2,80})/i,
  /\b(?:applying|applied|application)\s+(?:for|to)\s+(?<role>.{2,120}?)\s+(?:at|with)\s+(?<co>[^\n.!,;]{2,80})/i,
  /\breceived\s+your\s+application\s+for\s+(?:the\s+)?(?:position\s+of\s+)?(?<role>.{2,120}?)(?:\s+(?:position|role|job))?(?:\s*\([^)]*\))?\s+(?:at|with)\s+(?<co>[^\n.!,;]{2,80})/i,
];

/** Role alone ("received your application for Backend Engineer."): company then comes from the subject or sender. */
const ROLE_ONLY: RegExp[] = [
  /\breceived\s+your\s+application\s+for\s+(?:the\s+)?(?:position\s+of\s+)?(?<role>[^\n.!,;]{2,120}?)(?:\s+(?:position|role|job))?(?:\s*\([^)]*\))?\s*(?:[.!,;\n]|and\b)/i,
  /\byour\s+application\s+for\s+(?:the\s+)?(?<role>[^\n.!,;]{2,120}?)(?:\s+(?:position|role|job))?\s+(?:has been|was)\s+(?:received|submitted|sent)/i,
  /\bthank(?:s| you)\s+for\s+applying\s+(?:for|to)\s+(?:the\s+)?(?<role>[^\n.!,;]{2,120}?)\s+(?:position|role|job|opening)\b/i,
];

/** Company alone, from the subject: "Thank you for applying to Acme!", "Your application to Acme". */
const SUBJECT_COMPANY: RegExp[] = [
  /\b(?:applying|application|applied)\s+(?:to|with|at)\s+(?<co>[^!.?|:]{2,80}?)\s*(?:[!.?|:]|$)/i,
  /\binterest\s+in\s+(?<co>[^!.?|:]{2,80}?)\s*(?:[!.?|:]|$)/i,
];

/** "Location: Pune" (ends at the next "Label:" when wrapped lines were joined). */
const locationLine = (text: string) => clean(/\blocation\s*:\s*(.{2,80}?)(?=\s+[A-Z][\w ]{1,20}:|\n|$)/i.exec(text)?.[1]) || null;

/** The job's own link: the first one that canonicalizes to a posting id. */
function jobLink(links: string[]): string | null {
  for (const l of links) {
    if (/unsubscribe|settings|preferences|privacy|help|login|signin/i.test(l)) continue;
    const c = canonicalJobUrl(l);
    if (c?.externalId) return c.canonical;
  }
  return null;
}

function linkedin(raw: RawEmail): Partial<ExtractedJob> | null {
  // "Your application was sent to Alaan … Senior Backend Engineer … Alaan · Dubai, UAE (On-site) … Applied on …"
  const co = /\byour application was sent to\s+(?<co>[^\n]{2,80}?)\s*(?:\n|$|\s{2,})/i.exec(raw.subject)?.groups?.co ?? /\byour application was sent to\s+(?<co>.{2,80}?)(?=\s+\S)/i.exec(raw.text)?.groups?.co;
  if (!co) return null;
  const company = cleanCompany(co);
  const esc = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Two layouts seen: "<role> <company> · <location> (On-site) Applied on …" and "<role> <company> <location> View job: …".
  // The body only (the subject repeats "sent to <company>"), and the location stays on one line.
  const block = new RegExp(`sent to\\s+${esc}\\s+(?<role>[^\\n]{2,120}?)\\s+${esc}[ \\t]*(?:·[ \\t]*)?(?<loc>[^\\n(·]{2,100}?)(?:[ \\t]*\\((?:On-site|Remote|Hybrid)\\))?\\s+(?:Applied on|View job|Applied)`, 'i').exec(raw.text);
  return { companyName: company, roleTitle: block ? cleanRole(block.groups!.role) : null, location: block ? clean(block.groups!.loc) : null };
}

function naukri(raw: RawEmail): Partial<ExtractedJob> | null {
  const text = `${raw.subject}\n${raw.text}`;
  // "You have successfully applied to Node JS Developer at Acme Software" / "Applied: <role> - <company>"
  const m =
    /\b(?:successfully applied|application (?:has been )?sent|applied)\s+(?:to|for)\s+(?<role>.{2,120}?)\s+at\s+(?<co>[^\n.!,;]{2,80})/i.exec(text) ??
    /\bapplied:\s*(?<role>[^\n]{2,120}?)\s+[-–]\s+(?<co>[^\n]{2,80})/i.exec(raw.subject);
  if (!m) return null;
  return { companyName: cleanCompany(m.groups!.co), roleTitle: cleanRole(m.groups!.role), location: locationLine(raw.text) };
}

export function extractJob(raw: RawEmail): ExtractedJob {
  const portal = portalOf(domainOf(raw.from.address));
  const text = `${raw.subject}\n${raw.text.slice(0, 6000)}`;
  let found: Partial<ExtractedJob> | null = portal === 'linkedin' ? linkedin(raw) : portal === 'naukri' ? naukri(raw) : null;
  let explicit = Boolean(found?.companyName && found?.roleTitle);

  if (!explicit) {
    for (const r of ROLE_AT_COMPANY) {
      const m = r.exec(text);
      if (m?.groups && plausibleRole(cleanRole(m.groups.role)) && plausibleCompany(cleanCompany(m.groups.co))) {
        found = { ...found, roleTitle: cleanRole(m.groups.role), companyName: cleanCompany(m.groups.co) };
        explicit = true;
        break;
      }
    }
  }

  // Role from the wording, company from the subject (explicit too) or only from the sender's name (weaker).
  let companyFrom: 'wording' | 'subject' | 'sender' | null = found?.companyName ? 'wording' : null;
  if (!explicit) {
    const role = ROLE_ONLY.map((r) => r.exec(text)?.groups?.role).find((r) => r && plausibleRole(cleanRole(r)));
    const subjectCo = SUBJECT_COMPANY.map((r) => r.exec(raw.subject)?.groups?.co).find((c) => c && plausibleCompany(cleanCompany(c)));
    const senderCo = raw.from.name ? cleanCompany(raw.from.name.replace(/\s*(?:via|through)\s+\w+$/i, '')) : '';
    let company = found?.companyName ?? null;
    if (!company && subjectCo) [company, companyFrom] = [cleanCompany(subjectCo), 'subject'];
    if (!company && plausibleCompany(senderCo)) [company, companyFrom] = [senderCo, 'sender'];
    found = { ...found, roleTitle: found?.roleTitle ?? (role ? cleanRole(role) : null), companyName: company };
  }

  const companyName = found?.companyName && plausibleCompany(found.companyName) ? found.companyName : null;
  const roleTitle = found?.roleTitle && plausibleRole(found.roleTitle) ? found.roleTitle : null;
  const location = found?.location || locationLine(raw.text);
  const complete = Boolean(companyName && roleTitle);
  return {
    companyName,
    roleTitle,
    location,
    jobUrl: jobLink(raw.links),
    portal,
    confidence: !complete ? 0 : explicit ? 0.9 : companyFrom === 'subject' || companyFrom === 'wording' ? 0.85 : 0.75,
  };
}
