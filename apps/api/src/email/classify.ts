import type { ApplicationStatus } from '@jt/shared';

/**
 * Rule-based email classification (no AI). Each rule needs the platform's or employer's
 * typical wording; anything unclear is "other" (and may go to the AI fallback, if enabled).
 * Confidence is 0–1; the status rules decide what applies (Rejected only when high, Offer
 * always reviewed, unsure forward moves reviewed).
 */
export type EmailCategory = 'received' | 'viewed' | 'assessment' | 'interview' | 'rejected' | 'offer' | 'other';

export const CATEGORY_STATUS: Record<Exclude<EmailCategory, 'other'>, ApplicationStatus> = {
  received: 'applied',
  viewed: 'viewed',
  assessment: 'assessment',
  interview: 'interview',
  rejected: 'rejected',
  offer: 'offer',
};

export interface Classification {
  category: EmailCategory;
  confidence: number;
  /** Which rule matched (for logs/tests; never shown with the email's content). */
  rule: string | null;
  /** The sender is an applicant-tracking system or job portal (not the employer's own domain). */
  fromAts: boolean;
}

/** Applicant-tracking systems and job portals that send on behalf of employers. */
const ATS_DOMAINS = [
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'hire.lever.co', 'myworkday.com', 'workday.com', 'myworkdayjobs.com',
  'ashbyhq.com', 'smartrecruiters.com', 'icims.com', 'successfactors.com', 'successfactors.eu', 'sapsf.com', 'sapsf.eu', 'jobvite.com', 'workablemail.com', 'workable.com',
  'linkedin.com', 'naukri.com', 'instahyre.com', 'wellfound.com', 'hirist.tech', 'iimjobs.com', 'zohorecruit.com', 'zoho.com',
];

export const isAtsDomain = (domain: string) => ATS_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

type Rule = { category: Exclude<EmailCategory, 'other'>; confidence: number; name: string; test: (s: string, b: string) => boolean };

const any = (text: string, patterns: RegExp[]) => patterns.some((p) => p.test(text));

const RULES: Rule[] = [
  {
    category: 'rejected',
    confidence: 0.92,
    name: 'rejection wording',
    test: (s, b) =>
      any(`${s}\n${b}`, [
        /\bunfortunately\b[^.]{0,160}\b(?:not|won[’']t|will not|unable|decided|other candidates|another candidate|move forward|proceed)/i,
        /\b(?:decided|chosen|elected) to (?:move|go) forward with (?:other|another) candidate/i,
        /\bnot (?:be )?(?:moving|going) forward with your (?:application|candidacy)/i,
        /\bwill not be (?:moving forward|proceeding|progressing)\b/i,
        /\bregret to inform you\b/i,
        /\b(?:position|role) has (?:now )?been filled\b/i,
        /\bno longer under consideration\b/i,
        /\bnot (?:been )?selected (?:for|to)\b/i,
      ]),
  },
  {
    category: 'offer',
    confidence: 0.7,
    name: 'offer wording',
    test: (s, b) => any(`${s}\n${b}`, [/\boffer letter\b/i, /\b(?:pleased|delighted|happy|excited) to (?:extend|offer) you\b/i, /\bjob offer\b/i, /\boffer of employment\b/i]),
  },
  {
    category: 'interview',
    confidence: 0.8,
    name: 'interview scheduling',
    test: (s, b) =>
      /\binterview\b/i.test(`${s}\n${b}`) &&
      any(`${s}\n${b}`, [/\bschedul(?:e|ing)\b/i, /\bavailability\b/i, /\bcalendar (?:invite|invitation)\b/i, /\binvite you (?:to|for)\b/i, /\bnext round\b/i, /\b(?:zoom|google meet|teams) (?:link|meeting)\b/i, /\bbook a (?:time|slot)\b/i]),
  },
  {
    category: 'assessment',
    confidence: 0.82,
    name: 'assessment invitation',
    test: (s, b) =>
      any(`${s}\n${b}`, [/\b(?:online|coding|technical|aptitude) (?:assessment|test|challenge)\b/i, /\bhackerrank\b/i, /\bcodility\b/i, /\bhackerearth\b/i, /\bcodesignal\b/i, /\btestgorilla\b/i, /\bmettl\b/i, /\btake[- ]home (?:assignment|exercise|test)\b/i]),
  },
  {
    category: 'viewed',
    confidence: 0.75,
    name: 'application viewed',
    test: (s, b) => any(`${s}\n${b}`, [/\byour application (?:was|has been) viewed\b/i, /\brecruiter (?:has )?viewed your (?:application|profile)\b/i, /\bresume (?:was )?downloaded\b/i]),
  },
  {
    category: 'received',
    confidence: 0.88,
    name: 'application received',
    test: (s, b) =>
      any(`${s}\n${b}`, [
        /\bthank(?:s| you) for (?:applying|your application|your interest in)\b/i,
        /\b(?:we(?:'ve| have)|has been) received your application\b/i,
        /\bapplication (?:has been )?received\b/i,
        /\byour application (?:was|has been) (?:sent|submitted)\b/i,
        /\bapplication confirmation\b/i,
        /\b(?:you have )?successfully applied\b/i,
      ]),
  },
];

/** Precedence when several rules match: a decision outranks an acknowledgement. */
const ORDER: EmailCategory[] = ['rejected', 'offer', 'interview', 'assessment', 'viewed', 'received'];

/** `scores` overrides the rules' confidence per category (EMAIL_RULE_CONFIDENCE_JSON). */
export function classifyEmail(input: { subject: string; text: string; fromDomain: string }, scores: Partial<Record<EmailCategory, number>> = {}): Classification {
  const subject = input.subject ?? '';
  const body = (input.text ?? '').slice(0, 20_000);
  const fromAts = isAtsDomain(input.fromDomain);
  const hits = RULES.filter((r) => r.test(subject, body)).sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  const top = hits[0];
  if (!top) return { category: 'other', confidence: 0, rule: null, fromAts };
  const score = scores[top.category] ?? top.confidence;
  // "Thank you for applying… but we have an interview slot" style mixes: keep the precedence
  // winner, slightly less sure when an acknowledgement also matched.
  const mixed = hits.length > 1 && hits.some((h) => h.category === 'received') && top.category !== 'received';
  return { category: top.category, confidence: mixed ? Math.max(0, score - 0.05) : score, rule: top.name, fromAts };
}
