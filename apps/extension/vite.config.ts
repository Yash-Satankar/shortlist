import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';
import { buildManifest } from './src/manifest.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Builds the MV3 extension into dist/: popup (React), background service worker and the
 * generated manifest, plus the content scripts as self-contained IIFE files (Chrome can't
 * load content scripts as ES modules), built by a nested build after the main bundle.
 * `--mode development` points at localhost and adds dev-only features; production builds
 * (the zip and the Web Store) never contain them.
 */
export default defineConfig(({ mode }) => {
  const dev = mode === 'development';
  const apiOrigin = process.env.VITE_API_ORIGIN ?? (dev ? 'http://localhost:5173' : 'https://your-shortlist.example.com');

  const manifest: Plugin = {
    name: 'jst-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: JSON.stringify(buildManifest({ version: pkg.version, apiOrigin, dev }), null, 2),
      });
    },
  };

  const outDir = path.resolve(import.meta.dirname, 'dist');
  // Page-reader thresholds (see src/lib/tuning.ts), overridable at build time.
  const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const tuning = JSON.stringify(
    Object.fromEntries(
      Object.entries({ jdMinChars: num(process.env.VITE_JD_MIN_CHARS), jdSettleMaxMs: num(process.env.VITE_JD_SETTLE_MAX_MS), jdSettleIdleMs: num(process.env.VITE_JD_SETTLE_IDLE_MS) }).filter(([, v]) => v !== undefined),
    ),
  );
  // capture.js (fixture capture) exists only in development builds.
  const contentEntries = ['reader', 'auto', ...(dev ? ['capture'] : [])].map((name) => ({ name, file: path.resolve(import.meta.dirname, `src/content/${name}.ts`) }));
  const contentScripts: Plugin = {
    name: 'jst-content-scripts',
    buildStart() {
      for (const e of contentEntries) this.addWatchFile(e.file);
    },
    async closeBundle() {
      for (const e of contentEntries) {
        await build({
          configFile: false,
          logLevel: 'warn',
          publicDir: false,
          define: { __JST_DEV__: JSON.stringify(dev), __JST_TUNING__: tuning },
          build: {
            outDir,
            emptyOutDir: false,
            copyPublicDir: false,
            minify: !dev,
            sourcemap: dev ? 'inline' : false,
            rollupOptions: { input: e.file, output: { format: 'iife', entryFileNames: `content/${e.name}.js` } },
          },
        });
      }
    },
  };

  return {
    root: path.resolve(import.meta.dirname, 'src'),
    publicDir: path.resolve(import.meta.dirname, 'public'),
    plugins: [react(), tailwindcss(), manifest, contentScripts],
    define: {
      'import.meta.env.VITE_API_ORIGIN': JSON.stringify(apiOrigin),
      'import.meta.env.VITE_EXTENSION_VERSION': JSON.stringify(pkg.version),
      __JST_DEV__: JSON.stringify(dev),
      __JST_TUNING__: tuning,
    },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: dev,
      rollupOptions: {
        input: {
          popup: path.resolve(import.meta.dirname, 'src/popup/index.html'),
          background: path.resolve(import.meta.dirname, 'src/background.ts'),
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        },
      },
    },
  };
});
