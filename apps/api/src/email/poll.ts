import { featureState } from '@jt/shared';
import { and, asc, eq, lt } from 'drizzle-orm';
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

/** One IMAP run for the instance mailbox (read-only, from the stored cursor). */
export async function pollImap(db: Db, fetcher = fetchImap): Promise<PollResult> {
  const e = env();
  if (e.EMAIL_INTAKE_MODE !== 'imap' || !instanceFeatures().email_intake.offered) return { skipped: 'email intake (imap) not offered' };
  const cfg = imapConfig()!;
  const userId = await imapOwnerId(db);
  if (!userId) return { skipped: 'no mailbox owner' };
  if (!featureState('email_intake', await featureContext(db, userId)).enabled) return { skipped: 'switched off by the owner' };

  const key = mailboxKey(cfg);
  const [cur] = await db.select().from(emailCursors).where(and(eq(emailCursors.userId, userId), eq(emailCursors.mailboxKey, key)));
  try {
    const { emails: batch, cursor } = await fetcher(cfg, { uidValidity: cur?.uidValidity ?? null, lastUid: cur?.lastUid ?? 0 });
    const outcomes: Partial<Record<IngestOutcome, number>> = {};
    for (const raw of batch) {
      const r = await ingestEmail(db, userId, 'imap', raw);
      outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    }
    const values = { uidValidity: cursor.uidValidity, lastUid: cursor.lastUid, lastRunAt: new Date(), lastError: null };
    await db
      .insert(emailCursors)
      .values({ userId, mailboxKey: key, ...values })
      .onConflictDoUpdate({ target: [emailCursors.userId, emailCursors.mailboxKey], set: values });
    return { read: batch.length, outcomes };
  } catch (err) {
    const values = { lastRunAt: new Date(), lastError: safeError(err, cfg) };
    await db
      .insert(emailCursors)
      .values({ userId, mailboxKey: key, ...values })
      .onConflictDoUpdate({ target: [emailCursors.userId, emailCursors.mailboxKey], set: values });
    throw err;
  }
}

export async function purgeExpiredEmails(db: DbOrTx): Promise<number> {
  return (await db.delete(emails).where(lt(emails.expiresAt, new Date())).returning({ id: emails.id })).length;
}
