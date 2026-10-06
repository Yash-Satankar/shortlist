import type { ApplicationsList } from '../adapters/lists';
import { apiFetch, type Intent } from './api';

export interface PortalSyncSummary {
  read: number;
  proposed: number;
  unchanged: number;
  informational: number;
  unknownLabels: string[];
  pending: number;
}

/** Send a read applications list for review (proposals only: nothing changes until you accept). */
export function sendPortalSync(list: ApplicationsList, pageUrl: string, intent: Intent): Promise<PortalSyncSummary> {
  return apiFetch<PortalSyncSummary>('/portal-sync', {
    intent,
    method: 'POST',
    json: { site: list.site, pageUrl, items: list.rows, verified: list.verified },
  });
}

/** A stable fingerprint of a list read, so an identical re-read isn't sent again. */
export const listFingerprint = (list: ApplicationsList) =>
  JSON.stringify(list.rows.map((r) => [r.externalId ?? r.jobUrl, r.statusLabel]));
