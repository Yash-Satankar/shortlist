// Relative import (not @jt/shared): this file is also loaded by vite.config.ts under plain Node.
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from '../../../packages/shared/src/brand';

/**
 * MV3 manifest, generated at build time so the name/version come from one place.
 * Permissions are minimal: job sites are *optional* host permissions, granted per site
 * from the popup (nothing is read on any site until you opt in). The only required host
 * is our own API.
 */
export function buildManifest(opts: { version: string; apiOrigin: string; dev: boolean }) {
  return {
    manifest_version: 3,
    name: opts.dev ? `${PRODUCT_NAME} (dev)` : PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description: PRODUCT_DESCRIPTION,
    version: opts.version,
    icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    action: {
      default_title: PRODUCT_NAME,
      default_popup: 'popup/index.html',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
    },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: [`${opts.apiOrigin}/*`, ...(opts.dev ? ['http://localhost:5173/*', 'http://localhost:3000/*'] : [])],
    optional_host_permissions: [
      'https://*.linkedin.com/*',
      'https://*.naukri.com/*',
      'https://*.greenhouse.io/*',
      'https://*.lever.co/*',
      'https://*.myworkdayjobs.com/*',
      'https://*.myworkdaysite.com/*',
    ],
    minimum_chrome_version: '120',
  };
}
