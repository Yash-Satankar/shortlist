import { decideStatusChange, type ApplicationStatus, type EventSource, type StatusDecision } from '@jt/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import { applications, companies, statusEvents } from '../db/schema';
import { dateIn } from '../lib/dates';
import { conflict, notFound } from '../lib/http';
import { getUserSettings } from '../users/service';

export interface ProposeStatusInput {
  userId: string;
  applicationId: string;
  status: ApplicationStatus;
  source: EventSource;
  note?: string | null;
  occurredAt?: Date;
  evidence?: { type: string; id: string };
}

/** Locks the application row for the rest of the transaction (status changes are serialized). */
async function lockApplication(tx: Tx, userId: string, applicationId: string) {
  const [app] = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .for('update');
  if (!app) throw notFound('Application not found');
  return app;
}

async function applyStatus(tx: Tx, app: typeof applications.$inferSelect, to: ApplicationStatus, occurredAt: Date) {
  const { timezone } = await getUserSettings(tx, app.userId);
  const now = new Date();
  await tx
    .update(applications)
    .set({
      status: to,
      statusChangedAt: now,
      lastActivityAt: occurredAt > app.lastActivityAt ? occurredAt : app.lastActivityAt,
      // First move past "saved" stamps the applied date if it wasn't known.
      appliedOn: app.appliedOn ?? (to !== 'saved' ? dateIn(occurredAt, timezone) : null),
    })
    .where(eq(applications.id, app.id));
}

/**
 * The single entry point for status changes from any source. The rules in
 * @jt/shared decide whether the change applies, is ignored, or waits for review;
 * every proposal is written to the timeline either way.
 */
export async function proposeStatus(db: Db, input: ProposeStatusInput) {
  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, input.userId, input.applicationId);
    const decision: StatusDecision = decideStatusChange({ current: app.status, proposed: input.status, source: input.source });

    // A manual "change" to the current status is just a no-op, not worth a timeline entry.
    if (decision.reason === 'no_change' && !input.evidence) return { decision, event: null };

    const occurredAt = input.occurredAt ?? new Date();
    const [event] = await tx
      .insert(statusEvents)
      .values({
        userId: input.userId,
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: input.status,
        source: input.source,
        disposition: decision.disposition,
        reason: decision.reason,
        occurredAt,
        note: input.note ?? null,
        evidenceType: input.evidence?.type ?? null,
        evidenceId: input.evidence?.id ?? null,
      })
      .returning();

    if (decision.disposition === 'applied') await applyStatus(tx, app, input.status, occurredAt);
    return { decision, event: event! };
  });
}

/** The latest event that actually changed the status (and hasn't itself been undone). */
async function latestEffectiveEvent(tx: Tx, applicationId: string) {
  const [event] = await tx
    .select()
    .from(statusEvents)
    .where(and(eq(statusEvents.applicationId, applicationId), eq(statusEvents.disposition, 'applied'), isNull(statusEvents.revertedAt)))
    .orderBy(desc(statusEvents.recordedAt), desc(statusEvents.occurredAt))
    .limit(1);
  return event;
}

/**
 * Undo = append a reverting event back to the previous status. Only the latest
 * effective change can be undone, which keeps the timeline linear: undoing an
 * undo is the same operation and restores the original status.
 */
export async function undoEvent(db: Db, userId: string, applicationId: string, eventId: string) {
  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, userId, applicationId);
    const latest = await latestEffectiveEvent(tx, app.id);
    if (!latest || latest.id !== eventId) {
      throw conflict('Only the most recent status change can be undone');
    }
    if (!latest.fromStatus) throw conflict('The first status of an application cannot be undone');

    const now = new Date();
    await tx.update(statusEvents).set({ revertedAt: now }).where(eq(statusEvents.id, latest.id));
    const [event] = await tx
      .insert(statusEvents)
      .values({
        userId,
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: latest.fromStatus,
        source: 'manual',
        disposition: 'applied',
        reason: 'user_action',
        occurredAt: now,
        revertsEventId: latest.id,
        note: 'Undo',
      })
      .returning();
    // Undo restores status but doesn't count as employer activity.
    await tx.update(applications).set({ status: latest.fromStatus, statusChangedAt: now }).where(eq(applications.id, app.id));
    return event!;
  });
}

/** Accept (apply now, as a user decision) or dismiss an event that was flagged for review. */
export async function reviewEvent(db: Db, userId: string, applicationId: string, eventId: string, decision: 'accept' | 'dismiss') {
  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, userId, applicationId);
    const [event] = await tx
      .select()
      .from(statusEvents)
      .where(and(eq(statusEvents.id, eventId), eq(statusEvents.applicationId, app.id)));
    if (!event) throw notFound('Event not found');
    if (event.disposition !== 'pending_review') throw conflict('This event is not awaiting review');

    if (decision === 'dismiss' || app.status === event.toStatus) {
      const [updated] = await tx
        .update(statusEvents)
        .set({ disposition: 'dismissed' })
        .where(eq(statusEvents.id, event.id))
        .returning();
      return updated!;
    }

    // Accepting makes it the newest effective change, from whatever the status is now.
    const [updated] = await tx
      .update(statusEvents)
      .set({ disposition: 'applied', reason: 'user_action', fromStatus: app.status, recordedAt: new Date() })
      .where(eq(statusEvents.id, event.id))
      .returning();
    await applyStatus(tx, app, event.toStatus, event.occurredAt);
    return updated!;
  });
}

export async function editEvent(
  db: Db,
  userId: string,
  applicationId: string,
  eventId: string,
  patch: { note?: string | null; occurredAt?: string },
) {
  const [event] = await db
    .update(statusEvents)
    .set({
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.occurredAt ? { occurredAt: new Date(patch.occurredAt) } : {}),
    })
    .where(and(eq(statusEvents.id, eventId), eq(statusEvents.applicationId, applicationId), eq(statusEvents.userId, userId)))
    .returning();
  if (!event) throw notFound('Event not found');
  return event;
}

export function listPendingReviews(db: Db, userId: string) {
  return db
    .select({
      event: statusEvents,
      application: { id: applications.id, roleTitle: applications.roleTitle, status: applications.status },
      company: { id: companies.id, name: companies.name },
    })
    .from(statusEvents)
    .innerJoin(applications, eq(applications.id, statusEvents.applicationId))
    .innerJoin(companies, eq(companies.id, applications.companyId))
    .where(and(eq(statusEvents.userId, userId), eq(statusEvents.disposition, 'pending_review')))
    .orderBy(desc(statusEvents.recordedAt));
}
