import { featureState } from '@jt/shared';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { env } from '../config/env';
import { featureContext, instanceFeatures } from '../config/features';
import type { Db, DbOrTx } from '../db/client';
import { emailCursors, emails, users } from '../db/schema';
import { ingestEmail, type IngestOutcome } from './ingest';
import { fetchImap, mailboxKey, type ImapConfig } from './sources';

export function imapConfig(): ImapConfig | null {
  const e = env();
  if (!e.IMAP_HOST || !e.IMAP_USER || !e.IMAP_PASSWORD) return null;
  return { host: e.IMAP_HOST, port: e.IMAP_PORT, secure: e.IMAP_SECURE, user: e.IMAP_USER, password: e.IMAP_PASSWORD, mailbox: e.IMAP_MAILBOX, sinceDays: e.IMAP_SINCE_DAYS, maxPerRun: e.IMAP_MAX_PER_RUN };
}

/** The account the instance mailbox belongs to: IMAP_OWNER_EMAIL, else the first admin. */
export async function imapOwnerId(db: DbOrTx): Promise<string | null> {
  const e = env();
  const [owner] = e.IMAP_OWNER_EMAIL
    ? await db.select({ id: users.id }).from(users).where(eq(users.email, e.IMAP_OWNER_EMAIL.toLowerCase()))
    : await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).orderBy(asc(users.createdAt)).limit(1);
  return owner?.id ?? null;
}

/** Errors are stored for the Settings status line: short, and never containing credentials. */
const safeError = (err: unknown, cfg: ImapConfig) =>
  (err instanceof Error ? err.message : String(err)).split(cfg.password).join('[redacted]').split(cfg.user).join('[mailbox]').slice(0, 200);

export type PollResult = { skipped: string } | { read: number; outcomes: Partial<Record<IngestOutcome, number>> };

/**
 * Takes the mailbox's lease (creating its cursor row on first use). Returns false when another
 * run holds it, so runs never overlap: scheduled ones, "Check now", or a second server.
 */
async function acquireLease(db: Db, userId: string, key: string): Promise<boolean> {
  const until = sql`now() + make_interval(mins => ${env().EMAIL_POLL_LOCK_MINUTES})`;
  await db.insert(emailCursors).values({ userId, mailboxKey: key }).onConflictDoNothing();
  const got = await db
    .update(emailCursors)
    .set({ lockedUntil: until })
    .where(and(eq(emailCursors.userId, userId), eq(emailCursors.mailboxKey, key), or(isNull(emailCursors.lockedUntil), lt(emailCursors.lockedUntil, sql`now()`))))
    .returning({ id: emailCursors.id });
  return got.length > 0;
}

/** One IMAP run for the instance mailbox (read-only, from the stored cursor). */
export async function pollImap(db: Db, fetcher = fetchImap): Promise<PollResult> {
  const e = env();
  if (e.EMAIL_INTAKE_MODE !== 'imap' || !instanceFeatures().email_intake.offered) return { skipped: 'email intake (imap) not offered' };
  const cfg = imapConfig()!;
  const userId = await imapOwnerId(db);
  if (!userId) return { skipped: 'no mailbox owner' };
  if (!featureState('email_intake', await featureContext(db, userId)).enabled) return { skipped: 'switched off by the owner' };

  const key = mailboxKey(cfg);
  if (!(await acquireLease(db, userId, key))) return { skipped: 'already running' };
  const where = and(eq(emailCursors.userId, userId), eq(emailCursors.mailboxKey, key));
  const [cur] = await db.select().from(emailCursors).where(where);
  try {
    const { emails: batch, cursor } = await fetcher(cfg, { uidValidity: cur?.uidValidity ?? null, lastUid: cur?.lastUid ?? 0 });
    const outcomes: Partial<Record<IngestOutcome, number>> = {};
    for (const raw of batch) {
      const r = await ingestEmail(db, userId, 'imap', raw);
      outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    }
    const now = new Date();
    await db
      .update(emailCursors)
      .set({ uidValidity: cursor.uidValidity, lastUid: cursor.lastUid, lastRunAt: now, lastSuccessAt: now, lastError: null, failureCount: 0, lockedUntil: null })
      .where(where);
    return { read: batch.length, outcomes };
  } catch (err) {
    await db
      .update(emailCursors)
      .set({ lastRunAt: new Date(), lastError: safeError(err, cfg), failureCount: sql`${emailCursors.failureCount} + 1`, lockedUntil: null })
      .where(where);
    throw err;
  }
}

export interface MailboxHealth {
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  failureCount: number;
  /** Repeated failures, or no successful check for EMAIL_POLL_STALE_MINUTES: shown in Settings and Follow-ups. */
  needsAttention: boolean;
  reason: 'failing' | 'stale' | null;
}

/** The instance mailbox's health for its owner (null for everyone else, or when IMAP isn't offered). */
export async function mailboxHealth(db: DbOrTx, userId: string): Promise<MailboxHealth | null> {
  const e = env();
  if (e.EMAIL_INTAKE_MODE !== 'imap' || !instanceFeatures().email_intake.offered) return null;
  if ((await imapOwnerId(db)) !== userId) return null;
  if (!featureState('email_intake', await featureContext(db, userId)).enabled) return null;
  const [cur] = await db.select().from(emailCursors).where(and(eq(emailCursors.userId, userId), eq(emailCursors.mailboxKey, mailboxKey(imapConfig()!))));
  const failing = (cur?.failureCount ?? 0) >= e.EMAIL_POLL_ALERT_FAILURES;
  // Stale only once it has worked before, or has been trying for a while (a fresh setup isn't "broken").
  const since = cur?.lastSuccessAt ?? cur?.lastRunAt ?? null;
  const stale = since !== null && Date.now() - since.getTime() > e.EMAIL_POLL_STALE_MINUTES * 60_000;
  const reason = failing ? 'failing' : stale ? 'stale' : null;
  return {
    lastRunAt: cur?.lastRunAt ?? null,
    lastSuccessAt: cur?.lastSuccessAt ?? null,
    lastError: cur?.lastError ?? null,
    failureCount: cur?.failureCount ?? 0,
    needsAttention: reason !== null,
    reason,
  };
}

export async function purgeExpiredEmails(db: DbOrTx): Promise<number> {
  return (await db.delete(emails).where(lt(emails.expiresAt, new Date())).returning({ id: emails.id })).length;
}
