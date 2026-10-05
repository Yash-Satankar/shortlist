import type { SiteId } from '../lib/sites';

/** What the page reader reports. Step 3: the page itself; site adapters add the job in step 4. */
export interface PageRead {
  url: string;
  title: string;
  site: SiteId | null;
  readAt: string;
}

export interface PageReader {
  read: () => PageRead;
  autoRead: () => void;
}

export interface PageReadMessage {
  type: 'page-read';
  read: PageRead;
}

declare global {
  // Lives in the extension's isolated world only; the page's own scripts can't see it.
  var __jst: PageReader | undefined;
}
