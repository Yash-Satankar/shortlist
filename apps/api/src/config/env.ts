import { z } from 'zod';

/**
 * All runtime configuration comes from env. Nothing tunable is hard-coded:
 * add a variable here (with a default where safe) and document it in .env.example.
 */

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const encryptionKeys = z
  .string()
  .min(1, 'ENCRYPTION_KEYS is required (format: keyId:base64Key[,keyId:base64Key])')
  .transform((raw, ctx) => {
    const keys = new Map<string, Buffer>();
    for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
      const idx = part.indexOf(':');
      const id = part.slice(0, idx);
      const key = Buffer.from(part.slice(idx + 1), 'base64');
      if (idx <= 0 || !/^[a-z0-9]+$/i.test(id) || key.length !== 32) {
        ctx.addIssue({ code: 'custom', message: `Invalid encryption key entry "${id || part.slice(0, 8)}…": need keyId:<32 bytes base64>` });
        return z.NEVER;
      }
      keys.set(id, key);
    }
    return keys;
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Public origin of the app (web + API share it), e.g. https://jobtracker.up.railway.app */
    APP_ORIGIN: z.url().default('http://localhost:5173'),
    /** Number of reverse proxies in front of the app (Railway = 1). */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /** Serve the built web app from Express (production, same-origin). */
    SERVE_WEB: bool.default(false),
    WEB_DIST_DIR: z.string().optional(),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    ENCRYPTION_KEYS: encryptionKeys,
    ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),

    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
    SESSION_COOKIE_NAME: z.string().default('jt_sid'),
    /**
     * Who can create an account: closed (only the CLI or the first-run setup), invite (an admin's
     * invite link), open (anyone; needs email sending for verification, else it acts as invite).
     */
    SIGNUP_MODE: z.enum(['closed', 'invite', 'open']).optional(),
    /** DEPRECATED: use SIGNUP_MODE. ALLOW_SIGNUP=true means SIGNUP_MODE=open. */
    ALLOW_SIGNUP: bool.default(false),
    INVITE_TTL_DAYS: z.coerce.number().int().positive().default(7),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
    EMAIL_VERIFY_TTL_HOURS: z.coerce.number().int().positive().default(48),
    /**
     * Email sending (verification, password reset). Off unless SMTP_HOST and MAIL_FROM are set;
     * without it, sign-up can't be open and "Forgot password" is hidden (admins reset with the CLI).
     */
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    /** true: TLS from the start (port 465); false: STARTTLS when the server offers it. */
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM: z.string().min(3).optional(),
    /** Per-user requests per minute to the expensive endpoints (AI, import, resume upload, mailbox check). */
    RATE_LIMIT_EXPENSIVE_PER_MIN: z.coerce.number().int().positive().default(20),
    LOGIN_RATE_LIMIT_PER_15MIN: z.coerce.number().int().positive().default(10),

    /** Defaults for per-user settings (users can override in the app). */
    GHOST_AFTER_DAYS: z.coerce.number().int().positive().default(21),
    FOLLOW_UP_AFTER_DAYS: z.coerce.number().int().positive().default(10),
    POST_INTERVIEW_FOLLOW_UP_DAYS: z.coerce.number().int().positive().default(5),
    /** Automatic signals with confidence >= this count as "high" (e.g. auto-apply a rejection). */
    /** After "Not yet" on a ghost suggestion, ask again after this many days (or on new activity). */
    GHOST_SUGGEST_DAYS: z.coerce.number().int().positive().default(7),
    CONFIDENCE_HIGH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.8),
    /** Extension "application submitted" detection: score for detectors verified on real pages… */
    DETECTION_VERIFIED_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.95),
    /** …and for those not verified yet (below the threshold → it waits in Follow-ups). */
    DETECTION_UNVERIFIED_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.4),
    /** Portal sync: how long the encrypted snapshot of a read list is kept. */
    PORTAL_SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    /** Score of a portal change you accepted in review (at/above the threshold → it applies). */
    PORTAL_CONFIRMED_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.9),

    /**
     * Public demo instance: fictional data (pnpm demo:seed, refreshed nightly), entered with "Try
     * the demo", read-only, and AI features served from pre-generated content (no provider calls).
     * Run it on its own database: the seed refuses a database holding any other account.
     */
    DEMO_MODE: bool.default(false),
    DEMO_USER_EMAIL: z.string().email().default('demo@example.com'),
    DEMO_REFRESH_CRON: z.string().default('41 2 * * *'),
    /** Server errors kept for the admin's "Recent errors" view (Settings), in days. */
    ERROR_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    /** Background jobs (pg-boss, schema "pgboss" in the same database). Off in tests. */
    JOBS_ENABLED: bool.default(true),
    /** Daily clean-up: expired portal snapshots, AI cache (and stored emails, with email intake). */
    JOB_PURGE_CRON: z.string().default('17 3 * * *'),

    /**
     * Email intake. imap: one mailbox per instance (self-hosting), read-only, owned by
     * IMAP_OWNER_EMAIL (default: the first admin). Use an app password, never your main one.
     */
    IMAP_HOST: z.string().min(1).optional(),
    IMAP_PORT: z.coerce.number().int().positive().default(993),
    IMAP_SECURE: bool.default(true),
    IMAP_USER: z.string().min(1).optional(),
    IMAP_PASSWORD: z.string().min(1).optional(),
    IMAP_MAILBOX: z.string().default('INBOX'),
    IMAP_OWNER_EMAIL: z.string().email().optional(),
    /** First run reads this many days back; later runs continue from where they stopped. */
    IMAP_SINCE_DAYS: z.coerce.number().int().positive().default(30),
    IMAP_MAX_PER_RUN: z.coerce.number().int().positive().default(200),
    EMAIL_POLL_CRON: z.string().default('*/5 * * * *'),
    /**
     * A run holds a lease on its mailbox so runs never overlap (scheduled, "Check now", a second
     * server). A crashed run's lease expires after this many minutes.
     */
    EMAIL_POLL_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
    /** After this many failed runs in a row, Settings and Follow-ups say the mailbox needs attention. */
    EMAIL_POLL_ALERT_FAILURES: z.coerce.number().int().positive().default(3),
    /** No successful check for this long (e.g. the scheduler stopped) also counts as needing attention. */
    EMAIL_POLL_STALE_MINUTES: z.coerce.number().int().positive().default(60),
    /** inbound: per-user forwarding addresses at this domain, delivered by Postmark's webhook. */
    INBOUND_EMAIL_DOMAIN: z.string().min(3).optional(),
    INBOUND_WEBHOOK_USER: z.string().min(1).optional(),
    INBOUND_WEBHOOK_PASSWORD: z.string().min(12).optional(),
    /** Stored emails (encrypted) are deleted after this many days. */
    EMAIL_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    EMAIL_EXCERPT_CHARS: z.coerce.number().int().positive().default(4000),
    /** Highest confidence an email gets when matched by company alone (below the threshold → review). */
    EMAIL_COMPANY_MATCH_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
    /**
     * Score of an email that the rules classified, sent by a known job portal / ATS, and matched
     * by the job's own link (at/above the threshold → forward moves apply, undoable).
     */
    EMAIL_ATS_LINK_MATCH_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.92),
    /** Highest score the AI fallback can give an email. */
    EMAIL_AI_MAX_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
    /** Override the rules' scores per category: {"viewed": 0.75, "rejected": 0.92, …} */
    EMAIL_RULE_CONFIDENCE_JSON: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return {} as Partial<Record<'received' | 'viewed' | 'assessment' | 'interview' | 'rejected' | 'offer', number>>;
        try {
          const ok = z.partialRecord(z.enum(['received', 'viewed', 'assessment', 'interview', 'rejected', 'offer']), z.number().min(0).max(1)).safeParse(JSON.parse(v));
          if (ok.success) return ok.data;
        } catch {
          // fall through
        }
        ctx.addIssue({ code: 'custom', message: 'EMAIL_RULE_CONFIDENCE_JSON must be {"category": 0-1}' });
        return z.NEVER;
      }),
    DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),

    /**
     * Instance features: what this deployment offers. Users switch them on/off for themselves
     * within this (Settings). See packages/shared/src/features.ts.
     */
    FEATURE_AI: bool.default(true),
    FEATURE_EMAIL_INTAKE: bool.default(false),
    EMAIL_INTAKE_MODE: z.enum(['imap', 'inbound']).default('imap'),
    FEATURE_EXTENSION: bool.default(true),
    FEATURE_PORTAL_SYNC: bool.default(true),
    FEATURE_PREP: bool.default(true),
    FEATURE_CHAT: bool.default(true),
    FEATURE_FOLLOWUP_DRAFTS: bool.default(true),

    /**
     * AI (bring your own key). Users add keys in Settings. Instance keys below are optional,
     * for self-hosters, and serve admin accounts only — leave them unset on a public instance.
     */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    TOGETHER_API_KEY: z.string().min(1).optional(),
    OPENAI_COMPATIBLE_BASE_URL: z.url().optional(),
    OPENAI_COMPATIBLE_API_KEY: z.string().min(1).optional(),
    /** Default monthly AI spend cap per user, in DEFAULT_CURRENCY (users can change theirs). */
    LLM_MONTHLY_CAP_DEFAULT: z.coerce.number().min(0).default(500),
    DEFAULT_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default('INR'),
    /** Units of DEFAULT_CURRENCY per US dollar, for cost estimates (users can change theirs). */
    DEFAULT_USD_RATE: z.coerce.number().positive().default(88),
    LLM_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(30),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    /** Longest text sent to a model in one call (characters); longer input is refused, not cut. */
    LLM_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(40_000),
    LLM_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(20),
    /**
     * Allow OpenAI-compatible base URLs on private/local addresses (e.g. a model server on your
     * LAN). Self-hosting only: on a shared instance this lets users reach your private network.
     */
    LLM_ALLOW_PRIVATE_BASE_URLS: bool.default(false),
    /**
     * Default model per provider and task (when the user hasn't picked one), over the built-in
     * defaults: {"groq": {"extraction": "openai/gpt-oss-20b"}, "together": {"prep": "…"}}
     */
    LLM_DEFAULT_MODELS_JSON: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return {} as Partial<Record<'anthropic' | 'groq' | 'together', Partial<Record<'extraction' | 'classification' | 'prep' | 'chat', string>>>>;
        try {
          const task = z.partialRecord(z.enum(['extraction', 'classification', 'prep', 'chat']), z.string().min(1));
          const ok = z.partialRecord(z.enum(['anthropic', 'groq', 'together']), task).safeParse(JSON.parse(v));
          if (ok.success) return ok.data;
        } catch {
          // fall through
        }
        ctx.addIssue({ code: 'custom', message: 'LLM_DEFAULT_MODELS_JSON must be {"provider": {"task": "model"}}' });
        return z.NEVER;
      }),
    /**
     * Which provider runs a task when the user has keys for several and hasn't chosen, over the
     * built-in order: {"prep": ["together", "anthropic", "groq"]}. Providers left out come after.
     */
    LLM_TASK_PROVIDERS_JSON: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return {} as Partial<Record<'extraction' | 'classification' | 'prep' | 'chat', ('anthropic' | 'groq' | 'together' | 'openai_compatible')[]>>;
        try {
          const ok = z
            .partialRecord(z.enum(['extraction', 'classification', 'prep', 'chat']), z.array(z.enum(['anthropic', 'groq', 'together', 'openai_compatible'])))
            .safeParse(JSON.parse(v));
          if (ok.success) return ok.data;
        } catch {
          // fall through
        }
        ctx.addIssue({ code: 'custom', message: 'LLM_TASK_PROVIDERS_JSON must be {"task": ["provider", …]}' });
        return z.NEVER;
      }),
    /**
     * Reasoning models on OpenAI-compatible providers (regex on the model id): they get
     * LLM_REASONING_EFFORT, and LLM_REASONING_HEADROOM_TOKENS on top of the answer's token
     * budget, since their thinking counts toward the limit.
     */
    LLM_REASONING_MODELS: z
      .string()
      .default('^openai/gpt-oss')
      .transform((v, ctx) => {
        try {
          return new RegExp(v, 'i');
        } catch {
          ctx.addIssue({ code: 'custom', message: 'LLM_REASONING_MODELS must be a valid regular expression' });
          return z.NEVER;
        }
      }),
    LLM_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
    LLM_REASONING_HEADROOM_TOKENS: z.coerce.number().int().min(0).default(1024),
    /**
     * Ask my job search. Emails are only searched for users who switch it on (this is the
     * default for everyone else): their decrypted excerpts go to the user's AI provider.
     */
    ASK_INCLUDE_EMAILS_DEFAULT: bool.default(false),
    /** Most sources (applications, JDs, answers, emails) sent with one question. */
    ASK_MAX_SOURCES: z.coerce.number().int().positive().default(12),
    /** Characters of each source sent (a window around the matching words). */
    ASK_SNIPPET_CHARS: z.coerce.number().int().positive().default(700),
    /** Most stored emails decrypted (in memory) and scanned per question, newest first. */
    ASK_MAX_EMAILS_SCANNED: z.coerce.number().int().positive().default(500),
    ASK_MAX_QUESTION_CHARS: z.coerce.number().int().positive().default(500),
    /** Rows listed in an exact (database) answer. */
    ASK_MAX_LIST_ROWS: z.coerce.number().int().positive().default(50),
    ASK_ANSWER_MAX_TOKENS: z.coerce.number().int().positive().default(700),
    /** Prep packs: the model's output budget, and the most JD / resume text sent. */
    PREP_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(3000),
    PREP_MAX_JD_CHARS: z.coerce.number().int().positive().default(12_000),
    PREP_MAX_RESUME_CHARS: z.coerce.number().int().positive().default(8000),
    PREP_MAX_ANSWERS: z.coerce.number().int().positive().default(30),
    /** Follow-up drafts: output budget, and LinkedIn's connection-note limit (enforced). */
    DRAFT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(900),
    LINKEDIN_NOTE_MAX_CHARS: z.coerce.number().int().positive().default(300),
    /** Extra/override prices, USD per 1M tokens: {"model-id": [input, output]} */
    LLM_PRICES_JSON: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v) return {} as Record<string, [number, number]>;
        try {
          const parsed = JSON.parse(v) as unknown;
          const ok = z.record(z.string(), z.tuple([z.number().min(0), z.number().min(0)])).safeParse(parsed);
          if (ok.success) return ok.data;
        } catch {
          // fall through
        }
        ctx.addIssue({ code: 'custom', message: 'LLM_PRICES_JSON must be {"model": [inputUsdPer1M, outputUsdPer1M]}' });
        return z.NEVER;
      }),
  })
  .refine((e) => e.ENCRYPTION_KEYS.has(e.ENCRYPTION_ACTIVE_KEY_ID), {
    message: 'ENCRYPTION_ACTIVE_KEY_ID must match a key id in ENCRYPTION_KEYS',
    path: ['ENCRYPTION_ACTIVE_KEY_ID'],
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Lazily parsed so scripts and tests can set process.env first. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Tests only: re-read process.env on the next env() call. */
export function resetEnvCache(): void {
  cached = undefined;
}
