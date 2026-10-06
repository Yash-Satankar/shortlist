import { defineConfig, devices } from '@playwright/test';

/**
 * Critical paths, end to end, against the production build: the API serves the built web app
 * (`pnpm build` first) on the test database, which global-setup resets. No external services:
 * AI, email and background jobs are off.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'postgres://jobtracker:jobtracker@localhost:5433/jobtracker_test';

export const E2E_USER = { email: 'e2e@example.com', password: 'correct horse battery staple' };

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    // Locally, the installed Chrome; in CI, Playwright's own Chromium.
    channel: process.env.CI ? undefined : 'chrome',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: process.env.CI ? undefined : 'chrome' } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'node ../api/dist/server.js',
    url: `${BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'development',
      PORT: String(PORT),
      APP_ORIGIN: BASE,
      SERVE_WEB: 'true',
      WEB_DIST_DIR: '../web/dist',
      DATABASE_URL,
      ENCRYPTION_KEYS: process.env.ENCRYPTION_KEYS ?? 'k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      ENCRYPTION_ACTIVE_KEY_ID: process.env.ENCRYPTION_ACTIVE_KEY_ID ?? 'k1',
      JOBS_ENABLED: 'false',
      FEATURE_EMAIL_INTAKE: 'false',
      LOG_LEVEL: 'warn',
    },
  },
});
