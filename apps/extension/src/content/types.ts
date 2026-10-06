import type { ApplicationsList } from '../adapters/lists';
import type { SubmittedSignal } from '../adapters/submitted';
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
  /** Your applications list on a portal (portal sync), when this is that page. */
  list: ApplicationsList | null;
}

export interface PageReader {
  /** `manual`: you pressed Sync, so an unknown site is treated as a job page. */
  read: (manual?: boolean) => Promise<PageRead>;
  autoRead: () => void;
  pageText: () => { text: string; truncated: boolean };
}

export interface PageReadMessage {
  type: 'page-read';
  read: PageRead;
}

/** Content script → background: the page shows a platform's "application submitted" confirmation. */
export interface SubmittedMessage {
  type: 'submitted';
  signal: SubmittedSignal;
  /** The job read from this page (fresh confirmations on the job page only). */
  job: ExtractedJob | null;
}

export type SubmittedOutcome = 'applied' | 'created' | 'review' | 'already' | 'ignored' | 'needs_details' | 'off' | 'error';

export interface SubmittedReply {
  outcome: SubmittedOutcome;
  applicationId?: string;
  eventId?: string;
}

/** Content script → background: the user clicked a button in the in-page notice. */
export type ToastActionMessage =
  | { type: 'undo-submitted'; applicationId: string; eventId: string; created: boolean }
  | { type: 'open-app'; path: string };

declare global {
  // Lives in the extension's isolated world only; the page's own scripts can't see it.
  var __jst: PageReader | undefined;
  /** Dev builds only: the sanitized page as a fixture. */
  var __jstCapture: ((opts: SanitizeOptions) => string) | undefined;
}
