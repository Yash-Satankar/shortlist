import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { apiTokens, sessions, users } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';
import { verifyPassword } from '../lib/password';
import { normalizeEmail } from '../users/service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sliding expiry is refreshed at most this often, to avoid a DB write per request. */
const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
export const API_TOKEN_PREFIX = 'jt_';

export async function authenticateUser(db: Db, email: string, password: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(email)) });
  const ok = await verifyPassword(user?.passwordHash, password);
  return ok && user ? user : null;
}

export async function createSession(db: Db, userId: string, userAgent?: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * DAY_MS);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: userAgent?.slice(0, 300),
  });
  return { token, expiresAt };
}

/** Returns the session (refreshing its sliding expiry) or null if missing/expired. */
export async function validateSession(db: Db, token: string) {
  const session = await db.query.sessions.findFirst({
    where: and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())),
  });
  if (!session) return null;

  const now = Date.now();
  if (now - session.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    const expiresAt = new Date(now + env().SESSION_TTL_DAYS * DAY_MS);
    await db.update(sessions).set({ lastSeenAt: new Date(now), expiresAt }).where(eq(sessions.id, session.id));
    session.expiresAt = expiresAt;
  }
  return session;
}

export async function deleteSession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function deleteExpiredSessions(db: Db) {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export async function createApiToken(db: Db, userId: string, name: string) {
  const token = API_TOKEN_PREFIX + randomToken();
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, name, tokenHash: sha256(token), tokenPrefix: token.slice(0, 10) })
    .returning({ id: apiTokens.id, name: apiTokens.name, tokenPrefix: apiTokens.tokenPrefix, createdAt: apiTokens.createdAt });
  // The raw token is returned exactly once; only its hash is stored.
  return { ...row!, token };
}

export async function validateApiToken(db: Db, token: string) {
  const row = await db.query.apiTokens.findFirst({
    where: and(eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.revokedAt)),
  });
  if (!row) return null;
  const now = new Date();
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id));
  }
  return row;
}

export function listApiTokens(db: Db, userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(apiTokens.createdAt);
}

export async function revokeApiToken(db: Db, userId: string, tokenId: string): Promise<boolean> {
  const result = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return result.length > 0;
}
