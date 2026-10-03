import { APPLICATION_SOURCES, APPLICATION_STATUSES, CONTACT_ROLES, WORK_MODES } from '@jt/shared';
import { z } from 'zod';

/** Optional text: trimmed, empty string becomes null. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

const isoDate = z.iso.date();
const lpa = z.number().nonnegative().max(1000).nullish();

export const answerInput = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().max(5000),
  libraryItemId: z.uuid().nullish(),
});

const applicationFields = {
  companyName: z.string().trim().min(1).max(200),
  roleTitle: z.string().trim().min(1).max(300),
  location: text(200),
  workMode: z.enum(WORK_MODES),
  workModeDetail: text(100),
  experienceAsked: text(100),
  source: z.enum(APPLICATION_SOURCES),
  sourceDetail: text(200),
  jobUrl: z.url({ protocol: /^https?$/ }).max(2000).nullish().or(z.literal('').transform(() => null)),
  salaryListed: text(200),
  salaryMinLpa: lpa,
  salaryMaxLpa: lpa,
  expectedCtc: text(50),
  noticePeriodDays: z.number().int().min(0).max(365).nullish(),
  willingToRelocate: z.boolean().nullish(),
  appliedOn: isoDate.nullish(),
  followUpOn: isoDate.nullish(),
  notes: text(20_000),
};

export const createApplicationSchema = z.object({
  ...applicationFields,
  workMode: applicationFields.workMode.optional(),
  source: applicationFields.source.optional(),
  status: z.enum(APPLICATION_STATUSES).default('saved'),
  /** How the record was captured; bearer-token (extension) requests are always 'extension'. */
  via: z.enum(['manual', 'share']).default('manual'),
  jd: z.string().trim().max(100_000).optional(),
  answers: z.array(answerInput).max(100).optional(),
  /** Set after the user has seen a "likely duplicate" warning and wants to save anyway. */
  confirmDuplicate: z.boolean().default(false),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z
  .object({ ...applicationFields, archived: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

export const duplicateCheckSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  roleTitle: z.string().trim().min(1).max(300),
  jobUrl: z.string().max(2000).nullish(),
  excludeId: z.uuid().optional(),
});

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .optional();

export const listQuerySchema = z.object({
  status: csv(APPLICATION_STATUSES),
  source: csv(APPLICATION_SOURCES),
  workMode: csv(WORK_MODES),
  city: z.string().trim().max(100).optional(),
  q: z.string().trim().max(200).optional(),
  appliedFrom: isoDate.optional(),
  appliedTo: isoDate.optional(),
  archived: z.enum(['true', 'false', 'all']).default('false'),
  sort: z.enum(['applied_desc', 'applied_asc', 'updated_desc', 'company_asc']).default('applied_desc'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const statusChangeSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  note: text(2000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export const eventEditSchema = z
  .object({ note: text(2000), occurredAt: z.iso.datetime({ offset: true }) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const reviewDecisionSchema = z.object({ decision: z.enum(['accept', 'dismiss']) });

export const jdSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  sourceUrl: z.url().max(2000).nullish(),
});

export const answersReplaceSchema = z.object({ answers: z.array(answerInput).max(100) });

export const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.enum(CONTACT_ROLES).default('recruiter'),
  email: text(254),
  phone: text(50),
  linkedinUrl: text(500),
  notes: text(5000),
});
export const contactUpdateSchema = contactSchema.partial();
