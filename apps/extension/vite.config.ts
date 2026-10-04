import { readFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { buildManifest } from './src/manifest.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Builds the MV3 extension into dist/: popup (React), background service worker and the
 * generated manifest. Content scripts (single-file bundles) are added in a later step.
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

  return {
    root: path.resolve(import.meta.dirname, 'src'),
    publicDir: path.resolve(import.meta.dirname, 'public'),
    plugins: [react(), tailwindcss(), manifest],
    define: {
      'import.meta.env.VITE_API_ORIGIN': JSON.stringify(apiOrigin),
      'import.meta.env.VITE_EXTENSION_VERSION': JSON.stringify(pkg.version),
      __JST_DEV__: JSON.stringify(dev),
    },
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist'),
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
