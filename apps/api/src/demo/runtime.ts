import { PRODUCT_NAME, STATUS_LABELS, type ApplicationSource, type ApplicationStatus, type DraftChannel, type DraftPurpose } from '@jt/shared';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { HttpError } from '../lib/http';

/**
 * Demo instance behaviour (DEMO_MODE=true). Read-only, and no AI provider is ever called:
 * counting questions are planned by simple rules and answered by the database; other questions
 * list the matching records; drafts come from templates; prep packs are pre-generated.
 */
export const isDemo = () => env().DEMO_MODE;

/** POSTs a demo visitor may make: signing in/out, and the AI features served without a model. */
const ALLOWED_WRITES = [/^\/auth\/(login|demo|logout)$/, /^\/ask\/?$/, /^\/drafts\/?$/];

export const demoWriteGuard: RequestHandler = (req, _res, next) => {
  if (!isDemo() || req.method === 'GET' || req.method === 'HEAD') return next();
  if (ALLOWED_WRITES.some((r) => r.test(req.path))) return next();
  next(new HttpError(403, `This is a read-only demo with fictional data. Self-host ${PRODUCT_NAME} to try everything.`, 'demo_read_only'));
};

const STATUS_WORDS: [RegExp, ApplicationStatus][] = [
  [/\breject/i, 'rejected'],
  [/\binterview/i, 'interview'],
  [/\boffer/i, 'offer'],
  [/\b(assessment|test)s?\b/i, 'assessment'],
  [/\bviewed\b/i, 'viewed'],
  [/\bghost/i, 'ghosted'],
  [/\bwithdr/i, 'withdrawn'],
];
const SOURCE_WORDS: [RegExp, ApplicationSource][] = [
  [/linkedin/i, 'linkedin'],
  [/naukri/i, 'naukri'],
  [/greenhouse/i, 'greenhouse'],
  [/lever/i, 'lever'],
  [/referr/i, 'referral'],
];

/** The demo's planner: a few phrasings, by rule (the real one is the user's AI model). */
export function demoPlan(question: string, today: string): Record<string, unknown> {
  const q = question.toLowerCase();
  const kind = /^\s*(how many|count|number of)/.test(q) ? 'count' : /^\s*(which|list|show|what (applications|companies|roles))/.test(q) ? 'list' : 'search';
  if (kind === 'search') return { kind };
  const reached = STATUS_WORDS.filter(([r]) => r.test(q)).map(([, s]) => s);
  const sources = SOURCE_WORDS.filter(([r]) => r.test(q)).map(([, s]) => s);
  let from: string | null = null;
  if (/this month/.test(q)) from = `${today.slice(0, 8)}01`;
  else if (/this week|last 7 days/.test(q)) from = new Date(Date.parse(today) - 6 * 86_400_000).toISOString().slice(0, 10);
  else if (/last 30 days|last month/.test(q)) from = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10);
  return { kind, reached, sources, dateField: from ? (reached.length ? 'reached' : 'applied') : null, from, to: from ? today : null, groupBy: /by status/.test(q) ? 'status' : /by source/.test(q) ? 'source' : null };
}

/** A follow-up draft from a template (the real one is written by the user's AI model). */
export function demoDraft(channel: DraftChannel, purpose: DraftPurpose, app: { company: string; role: string; status: ApplicationStatus }, firstName: string | null, candidate: string): { subject: string | null; body: string } {
  const hi = firstName ? `Hi ${firstName},` : 'Hi,';
  const why = purpose === 'post_interview' ? `Thank you for the conversation about the ${app.role} role. I enjoyed learning how the team works and I'm even more interested now.` : `I applied for the ${app.role} role at ${app.company} and wanted to check in on where things stand.`;
  if (channel === 'linkedin_note') return { subject: null, body: `${hi} ${purpose === 'post_interview' ? `thanks for the ${app.role} interview at ${app.company}.` : `I applied for the ${app.role} role at ${app.company}.`} I'd love to connect and stay in touch.` };
  if (channel === 'linkedin_message') return { subject: null, body: `${hi}\n\n${why} Happy to share anything else that helps.\n\nThanks,\n${candidate}` };
  return { subject: `${purpose === 'post_interview' ? 'Thank you' : 'Following up'}: ${app.role} (${STATUS_LABELS[app.status]})`, body: `${hi}\n\n${why}\n\nI'm still very interested, and happy to share anything else that would help.\n\nThanks,\n${candidate}` };
}
