/**
 * Packs the production build (dist/) into release/job-status-tracker-<version>.zip for the
 * Chrome Web Store. Refuses to pack a dev build.
 *
 *   pnpm --filter @jt/extension release   (production build + this)
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const manifest = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8')) as { name: string; version: string; permissions: string[] };
if (/\(dev\)/.test(manifest.name) || manifest.permissions.includes('downloads')) {
  console.error('dist/ is a dev build. Run `pnpm --filter @jt/extension release` (production build first).');
  process.exit(1);
}

const files: Record<string, Uint8Array> = {};
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (!p.endsWith('.map')) files[path.relative(DIST, p).split(path.sep).join('/')] = readFileSync(p);
  }
};
walk(DIST);

const outDir = path.join(ROOT, 'release');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `job-status-tracker-${manifest.version}.zip`);
writeFileSync(out, zipSync(files, { level: 9, mtime: new Date('2026-01-01T00:00:00Z') }));
console.log(`${path.relative(process.cwd(), out)}: ${Object.keys(files).length} files, ${(statSync(out).size / 1024).toFixed(0)} KB`);
