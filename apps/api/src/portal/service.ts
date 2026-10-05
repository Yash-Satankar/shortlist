import {
  canonicalJobUrl,
  decideStatusChange,
  LOCKED_STATUSES,
  mapPortalLabel,
  normalizeCompanyName,
  normalizeRoleTitle,
  PORTAL_SITE_LABELS,
  type ApplicationStatus,
  type PortalItem,
  type PortalSite,
  type PortalSyncRequest,
} from '@jt/shared';
import { and, count, desc, eq, inArray, lt } from 'drizzle-orm';
import { env } from '../config/env';
import { assertFeature } from '../config/features';
import type { Db, DbOrTx } from '../db/client';
import { applications, companies, portalSnapshots, portalSyncItems } from '../db/schema';
import { createApplication, findDuplicateMatches } from '../applications/service';
import { proposeStatus } from '../applications/status';

export const PORTAL_EVIDENCE = 'portal_snapshot';

/** A job's identity on a portal: its id, else its canonical link, else company + role. */
function jobKey(site: PortalSite, item: PortalItem): { key: string; jobUrl: string | null } {
  const url = item.jobUrl ?? (site === 'linkedin' && item.externalId && /^\d+$/.test(item.externalId) ? `https://www.linkedin.com/jobs/view/${item.externalId}/` : undefined);
  const canonical = canonicalJobUrl(url);
  if (canonical?.externalId) return { key: `id:${canonical.externalId}`, jobUrl: canonical.canonical };
  if (item.externalId) return { key: `id:${item.externalId}`, jobUrl: canonical?.canonical ?? null };
  if (canonical) return { key: `url:${canonical.canonical}`, jobUrl: canonical.canonical };
  return { key: `cr:${normalizeCompanyName(item.companyName)}|${normalizeRoleTitle(item.roleTitle)}`, jobUrl: null };
}

/** Removes snapshots past their retention (items keep their own copy; their link is cleared). */
export async function purgeExpiredSnapshots(db: DbOrTx): Promise<number> {
  const gone = await db.delete(portalSnapshots).where(lt(portalSnapshots.expiresAt, new Date())).returning({ id: portalSnapshots.id });
  return gone.length;
}

export interface SyncSummary {
  snapshotId: string;
  read: number;
  proposed: number;
  unchanged: number;
  /** Labels nobody has mapped yet (reported, never guessed). */
  unknownLabels: string[];
  /** Mapped labels that don't change a status (e.g. "No longer accepting applications"). */
  informational: number;
  pending: number;
}

/**
 * Stores the read (encrypted, expiring), then turns it into proposals for review: a tracked
 * job whose portal status would move it forward, or a job you applied to but don't track.
 * Re-syncing the same list adds nothing; a dismissed proposal is not proposed again.
 */
export async function recordSync(db: Db, userId: string, req: PortalSyncRequest): Promise<SyncSummary> {
  await assertFeature(db, userId, 'portal_sync');
  const e = env();
  await purgeExpiredSnapshots(db);

  const [snapshot] = await db
    .insert(portalSnapshots)
    .values({ userId, site: req.site, itemsEnc: JSON.stringify(req.items), itemCount: req.items.length, expiresAt: new Date(Date.now() + e.PORTAL_SNAPSHOT_RETENTION_DAYS * 86_400_000) })
    .returning({ id: portalSnapshots.id });

  const unknown = new Set<string>();
  let proposed = 0;
  let unchanged = 0;
  let informational = 0;

  for (const item of req.items) {
    const meaning = mapPortalLabel(req.site, item.statusLabel);
    if (!meaning) {
      unknown.add(item.statusLabel);
      continue;
    }
    if (!meaning.status) {
      informational++;
      continue;
    }
    const target: ApplicationStatus = meaning.status;
    const { key, jobUrl } = jobKey(req.site, item);

    const matches = await findDuplicateMatches(db, userId, { jobUrl, companyName: item.companyName, roleTitle: item.roleTitle });
    const exact = matches.find((m) => m.level === 'exact');
    const likely = matches.filter((m) => m.level === 'likely');
    const match = exact ?? (likely.length === 1 ? likely[0] : undefined);

    if (match) {
      // A job you've closed (Offer, Rejected, Withdrawn) isn't reopened by a portal status:
      // that stays a manual decision, so it isn't proposed at all.
      if (LOCKED_STATUSES.has(match.status as ApplicationStatus)) {
        unchanged++;
        continue;
      }
      const decision = decideStatusChange({ current: match.status as ApplicationStatus, proposed: target, source: 'portal', confidence: 'high' });
      if (decision.disposition === 'ignored') {
        unchanged++;
        continue;
      }
    }

    // Already proposed (or decided) for this job and status: nothing new.
    const prior = await db
      .select({ id: portalSyncItems.id, proposedStatus: portalSyncItems.proposedStatus, decision: portalSyncItems.decision })
      .from(portalSyncItems)
      .where(and(eq(portalSyncItems.userId, userId), eq(portalSyncItems.site, req.site), eq(portalSyncItems.jobKey, key)));
    if (prior.some((p) => p.proposedStatus === target && p.decision !== 'superseded')) continue;
    // A newer status for the same job replaces an older pending proposal.
    const stale = prior.filter((p) => p.decision === 'pending').map((p) => p.id);
    if (stale.length) await db.update(portalSyncItems).set({ decision: 'superseded', decidedAt: new Date() }).where(inArray(portalSyncItems.id, stale));

    await db.insert(portalSyncItems).values({
      userId,
      site: req.site,
      snapshotId: snapshot!.id,
      kind: match ? 'status' : 'new',
      applicationId: match?.id ?? null,
      matchedBy: match ? (exact ? 'url' : 'company_role') : null,
      jobKey: key,
      jobUrl,
      roleTitle: item.roleTitle,
      companyName: item.companyName,
      location: item.location ?? null,
      rawLabel: item.statusLabel,
      proposedStatus: target,
    });
    proposed++;
  }

  return { snapshotId: snapshot!.id, read: req.items.length, proposed, unchanged, unknownLabels: [...unknown], informational, pending: await pendingCount(db, userId) };
}

/** Pending proposals for the review panel, with each tracked job's current status. */
export async function pendingProposals(db: DbOrTx, userId: string) {
  const rows = await db
    .select({
      item: portalSyncItems,
      currentStatus: applications.status,
      appRole: applications.roleTitle,
      appCompany: companies.name,
    })
    .from(portalSyncItems)
    .leftJoin(applications, eq(applications.id, portalSyncItems.applicationId))
    .leftJoin(companies, eq(companies.id, applications.companyId))
    .where(and(eq(portalSyncItems.userId, userId), eq(portalSyncItems.decision, 'pending')))
    .orderBy(desc(portalSyncItems.createdAt));
  return rows.map(({ item, currentStatus, appRole, appCompany }) => ({
    id: item.id,
    site: item.site,
    kind: item.kind,
    matchedBy: item.matchedBy,
    applicationId: item.applicationId,
    companyName: appCompany ?? item.companyName,
    roleTitle: appRole ?? item.roleTitle,
    location: item.location,
    jobUrl: item.jobUrl,
    rawLabel: item.rawLabel,
    meaning: mapPortalLabel(item.site, item.rawLabel)?.meaning ?? null,
    currentStatus: currentStatus ?? null,
    proposedStatus: item.proposedStatus,
    createdAt: item.createdAt,
  }));
}

export async function pendingCount(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(portalSyncItems).where(and(eq(portalSyncItems.userId, userId), eq(portalSyncItems.decision, 'pending')));
  return row?.n ?? 0;
}

/**
 * Your review. Accepted proposals go through the normal rules as source "portal" (no backwards
 * moves; nothing leaves a final state; an Offer would still wait), with the raw label as the
 * only evidence on the timeline. New jobs are saved first, then moved like any other.
 */
export async function reviewProposals(db: Db, userId: string, input: { accept: string[]; dismiss: string[] }) {
  await assertFeature(db, userId, 'portal_sync');
  const ids = [...input.accept, ...input.dismiss];
  const items = await db
    .select()
    .from(portalSyncItems)
    .where(and(eq(portalSyncItems.userId, userId), eq(portalSyncItems.decision, 'pending'), inArray(portalSyncItems.id, ids)));
  const byId = new Map(items.map((i) => [i.id, i]));
  const now = new Date();
  const results: { id: string; outcome: 'applied' | 'review' | 'ignored' | 'created' | 'dismissed'; applicationId: string | null }[] = [];

  for (const id of input.dismiss) {
    if (!byId.has(id)) continue;
    await db.update(portalSyncItems).set({ decision: 'dismissed', decidedAt: now }).where(eq(portalSyncItems.id, id));
    results.push({ id, outcome: 'dismissed', applicationId: byId.get(id)!.applicationId });
  }

  for (const id of input.accept) {
    const item = byId.get(id);
    if (!item) continue;
    let applicationId = item.applicationId;
    let created = false;
    if (!applicationId) {
      const res = await createApplication(
        db,
        userId,
        {
          companyName: item.companyName,
          roleTitle: item.roleTitle,
          location: item.location,
          jobUrl: item.jobUrl,
          status: 'saved',
          via: 'manual',
          confirmDuplicate: true, // you just confirmed it in review
        } as Parameters<typeof createApplication>[2],
        'portal',
      );
      applicationId = res.application.id;
      created = true;
    }
    const { decision, event } = await proposeStatus(db, {
      userId,
      applicationId,
      status: item.proposedStatus,
      source: 'portal',
      confidence: env().PORTAL_CONFIRMED_CONFIDENCE,
      evidence: { type: PORTAL_EVIDENCE, id: item.snapshotId ?? item.id },
      note: `${PORTAL_SITE_LABELS[item.site]}: "${item.rawLabel}"`,
    });
    await db.update(portalSyncItems).set({ decision: 'accepted', decidedAt: now, eventId: event?.id ?? null, applicationId }).where(eq(portalSyncItems.id, id));
    results.push({
      id,
      outcome: created && decision.disposition === 'applied' ? 'created' : decision.disposition === 'applied' ? 'applied' : decision.disposition === 'pending_review' ? 'review' : 'ignored',
      applicationId,
    });
  }
  return { results, notFound: ids.filter((id) => !byId.has(id)).length };
}
