import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (whose root is src/ for the extension build).
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
