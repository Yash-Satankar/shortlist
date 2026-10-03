import type { ResolvedUserSettings, UserSettings } from '@jt/shared';
import { and, eq, ne } from 'drizzle-orm';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { profiles, sessions, users } from '../db/schema';
import { badRequest, conflict } from '../lib/http';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../lib/password';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function createUser(
  db: Db,
  input: { email: string; password: string; name?: string | null },
): Promise<{ id: string; email: string }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const email = normalizeEmail(input.email);
  const existing = await db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true } });
  if (existing) throw conflict('A user with that email already exists');

  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ email, passwordHash, name: input.name ?? null })
      .returning({ id: users.id, email: users.email });
    await tx.insert(profiles).values({ userId: user!.id, fullName: input.name ?? null });
    return user!;
  });
}

/**
 * Replaces the password and signs out every session except `keepSessionId`
 * (the caller's own, when changed from the web app). API tokens are left alone:
 * they're revoked separately so the extension isn't broken by a password change.
 */
export async function changePassword(
  db: Db,
  userId: string,
  newPassword: string,
  opts: { keepSessionId?: string } = {},
): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
    await tx
      .delete(sessions)
      .where(opts.keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, opts.keepSessionId)) : eq(sessions.userId, userId));
  });
}

/** Per-user settings with env defaults filled in. */
export function resolveSettings(settings: UserSettings | null | undefined): ResolvedUserSettings {
  const e = env();
  return {
    ghostAfterDays: settings?.ghostAfterDays ?? e.GHOST_AFTER_DAYS,
    followUpAfterDays: settings?.followUpAfterDays ?? e.FOLLOW_UP_AFTER_DAYS,
    timezone: settings?.timezone ?? e.DEFAULT_TIMEZONE,
  };
}
