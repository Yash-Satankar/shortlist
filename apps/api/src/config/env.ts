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
    DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),
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
