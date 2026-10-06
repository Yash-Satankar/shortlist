import { defineConfig } from 'tsup';

export default defineConfig({
  // Every CLI lives in src/scripts/ as its own entry (no entry-point detection inside shared modules).
  entry: ['src/server.ts', 'src/scripts/migrate.ts', 'src/scripts/seed.ts', 'src/scripts/create-user.ts', 'src/scripts/set-password.ts', 'src/scripts/set-role.ts', 'src/scripts/import-xlsx.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so bundle them in.
  noExternal: [/^@jt\//],
});
