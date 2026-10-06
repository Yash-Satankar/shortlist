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
    ALLOW_SIGNUP: bool.default(false),
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

    /** Background jobs (pg-boss, schema "pgboss" in the same database). Off in tests. */
    JOBS_ENABLED: bool.default(true),
    /** Daily clean-up: expired portal snapshots, AI cache (and stored emails, with email intake). */
    JOB_PURGE_CRON: z.string().default('17 3 * * *'),
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
