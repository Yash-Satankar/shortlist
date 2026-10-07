import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '../../packages/shared/src/brand';

// In dev, Vite proxies /api to Express so the browser sees one origin, the same as production.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The product name comes from one constant (packages/shared/src/brand.ts).
    { name: 'product-name', transformIndexHtml: (html: string) => html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME) },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered from main.tsx
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: PRODUCT_NAME,
        short_name: PRODUCT_NAME,
        description: PRODUCT_DESCRIPTION,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F5F5F1',
        theme_color: '#F5F5F1',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // GET, not POST: the share arrives as a top-level navigation, so the SameSite=Lax
        // session cookie is sent, and nothing writes until the user taps Save (which goes
        // through the normal same-origin, CSRF-guarded API).
        share_target: {
          action: '/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        // Cache the app shell only. API responses (personal data) are never cached.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'], // includes theme-init.js
        runtimeCaching: [],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    host: true, // reachable from a phone on the same Wi-Fi for mobile testing
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
