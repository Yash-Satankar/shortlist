import type { ExtractedJob } from '../adapters/types';
import type { SanitizeOptions } from '../capture/sanitize';
import type { SiteId } from '../lib/sites';

/** What the page reader reports: the page, and the job on it when it is a job page. */
export interface PageRead {
  url: string;
  title: string;
  site: SiteId | null;
  readAt: string;
  job: ExtractedJob | null;
}

export interface PageReader {
  /** `manual`: you pressed Sync, so an unknown site is treated as a job page. */
  read: (manual?: boolean) => PageRead;
  autoRead: () => void;
}

export interface PageReadMessage {
  type: 'page-read';
  read: PageRead;
}

declare global {
  // Lives in the extension's isolated world only; the page's own scripts can't see it.
  var __jst: PageReader | undefined;
  /** Dev builds only: the sanitized page as a fixture. */
  var __jstCapture: ((opts: SanitizeOptions) => string) | undefined;
}
