import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Tests use .env for secrets/keys but always point at the separate test database.
 * Imported by both globalSetup and each test file, so keep it idempotent.
 */
const envFile = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.ENCRYPTION_KEYS ??= `k1:${Buffer.alloc(32, 7).toString('base64')}`;
process.env.ENCRYPTION_ACTIVE_KEY_ID ??= 'k1';

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) throw new Error('DATABASE_URL_TEST must be set to run tests');
process.env.DATABASE_URL = testUrl;
