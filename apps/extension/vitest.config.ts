import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (whose root is src/ for the extension build).
export default defineConfig({
  define: { __JST_DEV__: 'false' },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
