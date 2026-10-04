import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { badRequest, forbidden, notFound, parse, unauthorized } from '../lib/http';
import { MIN_PASSWORD_LENGTH, verifyPassword } from '../lib/password';
import { changePassword, createUser, resolveSettings } from '../users/service';
import { requireAuth, requireSession, sessionCookieName, sessionCookieOptions } from './middleware';
import {
  authenticateUser,
  createApiToken,
  createSession,
  deleteSession,
  listApiTokens,
  listSessions,
  revokeApiToken,
  revokeSessions,
} from './service';

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

const signupSchema = credentialsSchema.extend({ name: z.string().trim().max(100).optional() });
const tokenCreateSchema = z.object({ name: z.string().trim().min(1).max(60) });
const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

export function authRouter(db: Db): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env().LOGIN_RATE_LIMIT_PER_15MIN,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: { code: 'rate_limited', message: 'Too many login attempts, try again later' } },
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = parse(credentialsSchema, req.body);
    const user = await authenticateUser(db, email, password);
    if (!user) throw unauthorized('Invalid email or password');
    const { token, expiresAt } = await createSession(db, user.id, req.get('user-agent'));
    res.cookie(sessionCookieName(), token, sessionCookieOptions(expiresAt));
    res.json({ user: publicUser(user) });
  });

  router.post('/signup', loginLimiter, async (req, res) => {
    if (!env().ALLOW_SIGNUP) throw forbidden('Sign-up is disabled');
    const input = parse(signupSchema, req.body);
    const created = await createUser(db, input);
    const { token, expiresAt } = await createSession(db, created.id, req.get('user-agent'));
    res.cookie(sessionCookieName(), token, sessionCookieOptions(expiresAt));
    const user = await db.query.users.findFirst({ where: eq(users.id, created.id) });
    res.status(201).json({ user: publicUser(user!) });
  });

  router.post('/logout', async (req, res) => {
    const token: unknown = req.cookies?.[sessionCookieName()];
    if (typeof token === 'string' && token) await deleteSession(db, token);
    res.clearCookie(sessionCookieName(), { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, async (req, res) => {
    const user = await db.query.users.findFirst({ where: eq(users.id, req.auth!.userId) });
    if (!user) throw unauthorized();
    res.json({ user: publicUser(user), auth: { via: req.auth!.via } });
  });

  router.post('/password', requireSession, loginLimiter, async (req, res) => {
    const { currentPassword, newPassword } = parse(passwordChangeSchema, req.body);
    const user = await db.query.users.findFirst({ where: eq(users.id, req.auth!.userId) });
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw badRequest('Current password is incorrect');
    }
    await changePassword(db, user.id, newPassword, { keepSessionId: req.auth!.sessionId });
    res.status(204).end();
  });

  // Signed-in devices. Sessions slide (SESSION_TTL_DAYS from last use) but can be revoked here.
  router.get('/sessions', requireSession, async (req, res) => {
    const rows = await listSessions(db, req.auth!.userId);
    res.json({ sessions: rows.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })) });
  });

  router.delete('/sessions/:id', requireSession, async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    if (!(await revokeSessions(db, req.auth!.userId, { id }))) throw notFound('Session not found');
    if (id === req.auth!.sessionId) res.clearCookie(sessionCookieName(), { path: '/' });
    res.status(204).end();
  });

  router.post('/sessions/revoke-others', requireSession, async (req, res) => {
    const revoked = await revokeSessions(db, req.auth!.userId, { exceptId: req.auth!.sessionId });
    res.json({ revoked });
  });

  // API tokens for the Chrome extension. Managing tokens requires a real session.
  router.get('/tokens', requireSession, async (req, res) => {
    res.json({ tokens: await listApiTokens(db, req.auth!.userId) });
  });

  router.post('/tokens', requireSession, async (req, res) => {
    const { name } = parse(tokenCreateSchema, req.body);
    res.status(201).json({ token: await createApiToken(db, req.auth!.userId, name) });
  });

  router.delete('/tokens/:id', requireSession, async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    if (!(await revokeApiToken(db, req.auth!.userId, id))) throw notFound('Token not found');
    res.status(204).end();
  });

  // "Disconnect" in the extension: a token may revoke itself (and nothing else).
  router.post('/tokens/self/revoke', requireAuth, async (req, res) => {
    if (req.auth!.via !== 'token' || !req.auth!.tokenId) throw forbidden('Only an API token can revoke itself');
    await revokeApiToken(db, req.auth!.userId, req.auth!.tokenId);
    res.status(204).end();
  });

  return router;
}

function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    settings: resolveSettings(user.settings),
  };
}
