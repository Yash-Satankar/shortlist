import { defineConfig } from 'drizzle-kit';

// Only `generate` uses this (it diffs the schema, no DB connection needed).
// Migrations are applied at runtime by src/db/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
