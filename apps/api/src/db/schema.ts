import {
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  CONTACT_ROLES,
  EVENT_DISPOSITIONS,
  EVENT_SOURCES,
  WORK_MODES,
  type SignalConfidence,
  type UserSettings,
} from '@jt/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { encryptedText, tsvector } from './types';

/*
 * Conventions
 * - Every user-owned table has user_id (multi-user ready; single user today).
 * - Calendar dates (applied_on, follow_up_on) are `date` strings (YYYY-MM-DD) to avoid TZ drift.
 * - Instants are timestamptz.
 * - Columns ending in _enc are AES-GCM encrypted (not searchable). JDs, answers and
 *   notes stay plaintext on purpose so Postgres full-text search works.
 */

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const userId = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const applicationStatus = pgEnum('application_status', APPLICATION_STATUSES);
export const eventSource = pgEnum('event_source', EVENT_SOURCES);
export const eventDisposition = pgEnum('event_disposition', EVENT_DISPOSITIONS);
export const workMode = pgEnum('work_mode', WORK_MODES);
export const applicationSource = pgEnum('application_source', APPLICATION_SOURCES);
export const contactRole = pgEnum('contact_role', CONTACT_ROLES);

// ---------------------------------------------------------------- users & auth

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(), // stored lower-cased
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  settings: jsonb('settings').$type<UserSettings>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Job-seeker profile: India-specific defaults used to prefill answers and prep packs. */
export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  fullName: text('full_name'),
  headline: text('headline'),
  currentLocation: text('current_location'),
  totalExperienceYears: numeric('total_experience_years', { precision: 4, scale: 1 }),
  noticePeriodDays: integer('notice_period_days'),
  relocation: text('relocation'), // free text, e.g. "Yes (Hyderabad preferred)"
  currentCtcEnc: encryptedText('current_ctc_enc'), // LPA, as entered
  expectedCtcEnc: encryptedText('expected_ctc_enc'),
  resumeText: text('resume_text'),
  resumeUpdatedAt: timestamp('resume_updated_at', { withTimezone: true }),
  /** Metadata of the last uploaded resume file. The file itself is never stored. */
  resumeFileName: text('resume_file_name'),
  resumeFileSize: integer('resume_file_size'),
  resumeMimeType: text('resume_mime_type'),
  resumeUploadedAt: timestamp('resume_uploaded_at', { withTimezone: true }),
  updatedAt: updatedAt(),
});

/** Browser sessions. The cookie holds a random token; only its hash is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: userId(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Long-lived bearer tokens for the Chrome extension (and later the Android app). */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(), // first chars, shown in UI to identify a token
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------- core tracker

export const companies = pgTable(
  'companies',
  {
    id: id(),
    userId: userId(),
    name: text('name').notNull(),
    /** Lower-cased, legal suffixes stripped ("Pvt Ltd", "Technologies"...). Used for matching. */
    normalizedName: text('normalized_name').notNull(),
    website: text('website'),
    careersUrl: text('careers_url'),
    notes: text('notes'),
    /** Created by `db:seed --demo`; removed by `db:seed --remove-demo`. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('companies_user_normalized_uq').on(t.userId, t.normalizedName),
    index('companies_normalized_trgm_idx').using('gin', t.normalizedName.op('gin_trgm_ops')),
  ],
);

export const applications = pgTable(
  'applications',
  {
    id: id(),
    userId: userId(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    roleTitle: text('role_title').notNull(),
    roleNormalized: text('role_normalized').notNull(),
    location: text('location'),
    workMode: workMode('work_mode').notNull().default('unknown'),
    workModeDetail: text('work_mode_detail'), // e.g. "Hybrid (3 days)"
    experienceAsked: text('experience_asked'), // as written in the posting, e.g. "2-5 yrs"
    source: applicationSource('source').notNull().default('other'),
    sourceDetail: text('source_detail'), // raw text, e.g. "LinkedIn Easy Apply"
    jobUrl: text('job_url'),
    /** Stable form of job_url (tracking params dropped, LinkedIn job id extracted...). */
    jobUrlCanonical: text('job_url_canonical'),
    externalJobId: text('external_job_id'),
    /** Stable identity of the spreadsheet row this came from; makes re-imports idempotent. */
    importKey: text('import_key'),
    salaryListed: text('salary_listed'), // as shown on the posting (public info, not encrypted)
    salaryMinLpa: numeric('salary_min_lpa', { precision: 6, scale: 2 }),
    salaryMaxLpa: numeric('salary_max_lpa', { precision: 6, scale: 2 }),
    /** What I told this company — can differ from the profile default. */
    expectedCtcEnc: encryptedText('expected_ctc_enc'),
    noticePeriodDays: integer('notice_period_days'),
    willingToRelocate: boolean('willing_to_relocate'),

    status: applicationStatus('status').notNull().default('saved'),
    /** Denormalized from status_events for fast list/kanban queries. */
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    appliedOn: date('applied_on', { mode: 'string' }),
    followUpOn: date('follow_up_on', { mode: 'string' }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** "Not yet" on a ghost suggestion. Hidden until new activity or GHOST_SUGGEST_DAYS pass. */
    ghostDismissedAt: timestamp('ghost_dismissed_at', { withTimezone: true }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),

    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce(role_title, '') || ' ' || coalesce(location, '') || ' ' || coalesce(experience_asked, '') || ' ' || coalesce(notes, ''))`,
    ),
  },
  (t) => [
    index('applications_user_status_idx').on(t.userId, t.status),
    index('applications_user_company_idx').on(t.userId, t.companyId),
    index('applications_user_follow_up_idx').on(t.userId, t.followUpOn),
    uniqueIndex('applications_user_job_url_uq')
      .on(t.userId, t.jobUrlCanonical)
      .where(sql`${t.jobUrlCanonical} is not null`),
    uniqueIndex('applications_user_import_key_uq')
      .on(t.userId, t.importKey)
      .where(sql`${t.importKey} is not null`),
    index('applications_role_trgm_idx').using('gin', t.roleNormalized.op('gin_trgm_ops')),
    index('applications_search_idx').using('gin', t.search),
  ],
);

/** JD snapshots. Captured once; never re-fetched from the live URL. Latest = current. */
export const jobDescriptions = pgTable(
  'job_descriptions',
  {
    id: id(),
    userId: userId(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    source: eventSource('source').notNull(),
    sourceUrl: text('source_url'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    search: tsvector('search').generatedAlwaysAs(sql`to_tsvector('english'::regconfig, content)`),
  },
  (t) => [
    index('job_descriptions_application_idx').on(t.applicationId, t.capturedAt),
    uniqueIndex('job_descriptions_application_hash_uq').on(t.applicationId, t.contentHash),
    index('job_descriptions_search_idx').using('gin', t.search),
  ],
);

/**
 * Append-only status timeline. Undo never deletes: it appends a new event with
 * reverts_event_id set and stamps reverted_at on the original.
 *
 * Every proposed change is recorded, including ones that did not change the status:
 * disposition = applied | ignored (e.g. stale "Applied" email after Interview) |
 * pending_review (automatic signal on a locked status) | dismissed (review rejected).
 */
export const statusEvents = pgTable(
  'status_events',
  {
    id: id(),
    userId: userId(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    fromStatus: applicationStatus('from_status'),
    toStatus: applicationStatus('to_status').notNull(),
    source: eventSource('source').notNull(),
    disposition: eventDisposition('disposition').notNull().default('applied'),
    /** Why the rules chose this disposition (see decideStatusChange in @jt/shared). */
    reason: text('reason'),
    /** DEPRECATED (no longer written): old high/low label. Superseded by confidence_score. */
    confidence: text('confidence').$type<SignalConfidence>(),
    /** For automatic sources: how sure the signal was, 0–1. Null for user actions (manual, import...). */
    confidenceScore: doublePrecision('confidence_score'),
    /** When it happened in the real world (e.g. email date); recorded_at is when we learned it. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
    /** Pointer to what caused it, e.g. { type: 'email', id } or { type: 'portal_snapshot', id }. */
    evidenceType: text('evidence_type'),
    evidenceId: uuid('evidence_id'),
    revertsEventId: uuid('reverts_event_id').references((): AnyPgColumn => statusEvents.id, { onDelete: 'set null' }),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
  },
  (t) => [
    index('status_events_application_idx').on(t.applicationId, t.occurredAt),
    index('status_events_pending_review_idx')
      .on(t.userId)
      .where(sql`${t.disposition} = 'pending_review'`),
  ],
);

/** Recruiters / hiring managers. Personal details are encrypted. */
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    userId: userId(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    role: contactRole('role').notNull().default('recruiter'),
    nameEnc: encryptedText('name_enc').notNull(),
    emailEnc: encryptedText('email_enc'),
    phoneEnc: encryptedText('phone_enc'),
    linkedinUrlEnc: encryptedText('linkedin_url_enc'),
    notesEnc: encryptedText('notes_enc'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('contacts_user_company_idx').on(t.userId, t.companyId)],
);

export const applicationContacts = pgTable(
  'application_contacts',
  {
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    userId: userId(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.applicationId, t.contactId] })],
);

/** My standard screening answers ("Years of Node.js" -> "3 years"). Prefills new applications. */
export const answerLibrary = pgTable(
  'answer_library',
  {
    id: id(),
    userId: userId(),
    question: text('question').notNull(),
    questionNormalized: text('question_normalized').notNull(),
    answer: text('answer').notNull(),
    category: text('category'),
    sortOrder: integer('sort_order').notNull().default(0),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('answer_library_user_question_uq').on(t.userId, t.questionNormalized)],
);

/** Screening Q&A actually submitted for one application. */
export const applicationAnswers = pgTable(
  'application_answers',
  {
    id: id(),
    userId: userId(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    libraryItemId: uuid('library_item_id').references(() => answerLibrary.id, { onDelete: 'set null' }),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, question || ' ' || answer)`,
    ),
  },
  (t) => [
    index('application_answers_application_idx').on(t.applicationId),
    index('application_answers_search_idx').using('gin', t.search),
  ],
);
