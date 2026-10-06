import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (whose root is src/ for the extension build).
export default defineConfig({
  define: { __JST_DEV__: 'false' },
  // Real-page fixtures are large (jsdom parses them); give them room on a busy CI runner.
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
