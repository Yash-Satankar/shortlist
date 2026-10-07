import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Tests use .env for secrets/keys but always point at the separate test database.
 * Imported by both globalSetup and each test file, so keep it idempotent.
 */
const envFile = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

process.env.NODE_ENV = 'test';
process.env.JOBS_ENABLED = 'false'; // tests call job handlers directly
// Tests never call real AI providers: drop any instance keys a developer has in .env.
for (const k of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'TOGETHER_API_KEY', 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_BASE_URL', 'LLM_PRICES_JSON']) delete process.env[k];
// …and never read a real mailbox: drop any email-intake settings from .env.
for (const k of Object.keys(process.env)) if (/^(FEATURE_EMAIL_INTAKE|EMAIL_INTAKE_MODE|IMAP_|INBOUND_)/.test(k)) delete process.env[k];
// …never send real email, and start from a closed sign-up (tests switch modes themselves).
for (const k of Object.keys(process.env)) if (/^(SMTP_|MAIL_FROM$|SIGNUP_MODE$|ALLOW_SIGNUP$|RATE_LIMIT_EXPENSIVE_PER_MIN$|DEMO_)/.test(k)) delete process.env[k];
process.env.LOG_LEVEL = 'silent';
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.ENCRYPTION_KEYS ??= `k1:${Buffer.alloc(32, 7).toString('base64')}`;
process.env.ENCRYPTION_ACTIVE_KEY_ID ??= 'k1';

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) throw new Error('DATABASE_URL_TEST must be set to run tests');
process.env.DATABASE_URL = testUrl;
