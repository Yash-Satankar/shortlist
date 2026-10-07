import { PRODUCT_NAME } from '@jt/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { env } from '../config/env';
import type { Db, DbOrTx } from '../db/client';
import { authTokens, invites, users } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';
import { badRequest, forbidden, HttpError, notFound } from '../lib/http';
import { mailEnabled, sendMail } from '../lib/mailer';
import { changePassword, createUser, normalizeEmail } from '../users/service';

/**
 * Accounts on a multi-user instance: who may sign up (SIGNUP_MODE), the first-run setup, admin
 * invites, email verification and password reset. Codes and links are random, single-use, and
 * stored only as hashes.
 */
export type SignupMode = 'closed' | 'invite' | 'open';

/** The mode in effect: open needs email sending (to verify addresses); without it, invite. */
export function signupMode(): SignupMode {
  const e = env();
  const wanted = e.SIGNUP_MODE ?? (e.ALLOW_SIGNUP ? 'open' : 'closed');
  return wanted === 'open' && !mailEnabled() ? 'invite' : wanted;
}

export async function userCount(db: DbOrTx): Promise<number> {
  const [r] = (await db.execute(sql`select count(*)::int as n from users`)).rows as { n: number }[];
  return r?.n ?? 0;
}

/** First-run setup: creates the admin, only while the instance has no users (race-safe). */
export async function setupAdmin(db: Db, input: { email: string; password: string; name?: string }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('jt:first-run-setup'))`);
    if ((await userCount(tx)) > 0) throw forbidden('This server is already set up. Sign in instead.');
    return createUser(tx as unknown as Db, { ...input, emailVerified: true });
  });
}

// ---------------------------------------------------------------- invites

export async function createInvite(db: DbOrTx, adminId: string, email?: string | null) {
  const code = `inv_${randomToken(18)}`;
  const expiresAt = new Date(Date.now() + env().INVITE_TTL_DAYS * 86_400_000);
  const [row] = await db
    .insert(invites)
    .values({ codeHash: sha256(code), email: email ? normalizeEmail(email) : null, createdBy: adminId, expiresAt })
    .returning({ id: invites.id, email: invites.email, expiresAt: invites.expiresAt, createdAt: invites.createdAt });
  return { ...row!, code, link: `${env().APP_ORIGIN}/?invite=${encodeURIComponent(code)}` };
}

export async function listInvites(db: DbOrTx) {
  return db
    .select({ id: invites.id, email: invites.email, expiresAt: invites.expiresAt, usedAt: invites.usedAt, createdAt: invites.createdAt })
    .from(invites)
    .orderBy(sql`${invites.createdAt} desc`)
    .limit(100);
}

export async function revokeInvite(db: DbOrTx, id: string) {
  const [row] = await db.delete(invites).where(and(eq(invites.id, id), isNull(invites.usedAt))).returning({ id: invites.id });
  if (!row) throw notFound('Invite not found (or already used)');
}

// ---------------------------------------------------------------- sign-up

/**
 * closed → refused. invite → needs a valid, unused, unexpired invite (and its email, if it names
 * one); the account is ready at once. open → the account waits for its email to be confirmed.
 */
export async function signUp(db: Db, input: { email: string; password: string; name?: string; invite?: string }): Promise<{ userId: string; verified: boolean }> {
  const mode = signupMode();
  if (mode === 'closed' && !input.invite) throw forbidden('Sign-up is closed on this server');
  if (input.invite || mode === 'invite') {
    if (!input.invite) throw forbidden('You need an invite link to create an account here');
    return db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invites)
        .where(and(eq(invites.codeHash, sha256(input.invite!)), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
        .for('update');
      if (!inv) throw new HttpError(403, 'That invite link is invalid, used or expired. Ask for a new one.', 'invite_invalid');
      if (inv.email && inv.email !== normalizeEmail(input.email)) throw new HttpError(403, 'That invite is for a different email address.', 'invite_email_mismatch');
      const user = await createUser(tx as unknown as Db, { email: input.email, password: input.password, name: input.name, emailVerified: true });
      await tx.update(invites).set({ usedAt: new Date(), usedBy: user.id }).where(eq(invites.id, inv.id));
      return { userId: user.id, verified: true };
    });
  }
  const user = await createUser(db, { email: input.email, password: input.password, name: input.name, emailVerified: false });
  await sendVerification(db, user.id, user.email);
  return { userId: user.id, verified: false };
}

// ---------------------------------------------------------------- one-time links

async function issueToken(db: DbOrTx, userId: string, purpose: 'reset' | 'verify', ttlMs: number) {
  const token = randomToken(24);
  // A new link replaces any earlier unused one for the same purpose.
  await db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));
  await db.insert(authTokens).values({ userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

/** Marks a link used and returns its user, or null if it's unknown, used or expired. */
async function consumeToken(db: DbOrTx, token: string, purpose: 'reset' | 'verify'): Promise<string | null> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning({ userId: authTokens.userId });
  return row?.userId ?? null;
}

export async function sendVerification(db: DbOrTx, userId: string, email: string): Promise<void> {
  const e = env();
  const token = await issueToken(db, userId, 'verify', e.EMAIL_VERIFY_TTL_HOURS * 3_600_000);
  await sendMail({
    to: email,
    subject: `Confirm your email for ${PRODUCT_NAME}`,
    text: `Confirm your email to finish creating your account:\n\n${e.APP_ORIGIN}/verify?token=${token}\n\nThe link works once and expires in ${e.EMAIL_VERIFY_TTL_HOURS} hours. If you didn't sign up, ignore this email.`,
  });
}

/** Resend a verification link. Always looks the same to the caller (no account probing). */
export async function resendVerification(db: DbOrTx, email: string): Promise<void> {
  const [u] = await db.select({ id: users.id, email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.email, normalizeEmail(email)));
  if (u && !u.verified) await sendVerification(db, u.id, u.email);
}

export async function verifyEmail(db: DbOrTx, token: string): Promise<string> {
  const userId = await consumeToken(db, token, 'verify');
  if (!userId) throw badRequest('That confirmation link is invalid or expired. Sign in to get a new one.');
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  return userId;
}

/** "Forgot password": emails a reset link if the account exists. Always looks the same to the caller. */
export async function requestPasswordReset(db: DbOrTx, email: string): Promise<void> {
  if (!mailEnabled()) throw new HttpError(404, 'Password reset by email isn’t available on this server. Ask its admin.', 'not_available');
  const e = env();
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, normalizeEmail(email)));
  if (!u) return;
  const token = await issueToken(db, u.id, 'reset', e.PASSWORD_RESET_TTL_MINUTES * 60_000);
  await sendMail({
    to: u.email,
    subject: `Reset your ${PRODUCT_NAME} password`,
    text: `Someone (hopefully you) asked to reset your password. Choose a new one here:\n\n${e.APP_ORIGIN}/reset?token=${token}\n\nThe link works once and expires in ${e.PASSWORD_RESET_TTL_MINUTES} minutes. If it wasn't you, ignore this email: your password stays the same.`,
  });
}

/** Sets the new password and signs out everywhere. */
export async function resetPassword(db: Db, token: string, newPassword: string): Promise<void> {
  const userId = await consumeToken(db, token, 'reset');
  if (!userId) throw badRequest('That reset link is invalid or expired. Ask for a new one.');
  await changePassword(db, userId, newPassword);
  // Proving you own the inbox also confirms the address.
  await db.update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` }).where(eq(users.id, userId));
}
