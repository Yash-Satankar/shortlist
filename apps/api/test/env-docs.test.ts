import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Self-hosters configure everything through env: every variable the server reads is documented in .env.example. */
describe('.env.example', () => {
  it('documents every variable in config/env.ts', () => {
    const schema = readFileSync(path.join(import.meta.dirname, '../src/config/env.ts'), 'utf8');
    const example = readFileSync(path.join(import.meta.dirname, '../../../.env.example'), 'utf8');
    const keys = [...schema.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(60);
    const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));
    expect(keys.filter((k) => !documented.has(k))).toEqual([]);
  });
});
