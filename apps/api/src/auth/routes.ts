import { eq } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { badRequest, forbidden, HttpError, notFound, parse, unauthorized } from '../lib/http';
import { MIN_PASSWORD_LENGTH, verifyPassword } from '../lib/password';
import { requireFeature } from '../config/features';
import { changePassword, resolveSettings } from '../users/service';
import { requestPasswordReset, resendVerification, resetPassword, setupAdmin, signUp, verifyEmail } from '../accounts/service';
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

const signupSchema = credentialsSchema.extend({
  name: z.string().trim().max(100).optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200),
  invite: z.string().trim().max(200).optional(),
});
const emailOnlySchema = z.object({ email: z.email().max(254) });
const tokenSchema = z.object({ token: z.string().trim().min(10).max(200) });
const resetSchema = tokenSchema.extend({ newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(200) });
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
    if (!user.emailVerifiedAt) throw new HttpError(403, 'Confirm your email first: we sent you a link.', 'email_unverified');
    const { token, expiresAt } = await createSession(db, user.id, req.get('user-agent'));
    res.cookie(sessionCookieName(), token, sessionCookieOptions(expiresAt));
    res.json({ user: publicUser(user) });
  });

  const startSession = async (req: Request, res: Response, userId: string, status = 200) => {
    const { token, expiresAt } = await createSession(db, userId, req.get('user-agent'));
    res.cookie(sessionCookieName(), token, sessionCookieOptions(expiresAt));
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    res.status(status).json({ user: publicUser(user!) });
  };

  /** Public demo: "Try the demo" signs you in as the fictional demo account (DEMO_MODE only). */
  router.post('/demo', loginLimiter, async (req, res) => {
    if (!env().DEMO_MODE) throw notFound('Not a demo server');
    const demo = await db.query.users.findFirst({ where: eq(users.email, env().DEMO_USER_EMAIL.toLowerCase()) });
    if (!demo) throw notFound('The demo isn’t seeded yet');
    await startSession(req, res, demo.id);
  });

  /** First-run setup: creates the admin while the server has no accounts (then it's gone). */
  router.post('/setup', loginLimiter, async (req, res) => {
    const input = parse(signupSchema.omit({ invite: true }), req.body);
    const created = await setupAdmin(db, input);
    await startSession(req, res, created.id, 201);
  });

  /** Sign-up per SIGNUP_MODE: invite → signed in at once; open → confirm your email first. */
  router.post('/signup', loginLimiter, async (req, res) => {
    const input = parse(signupSchema, req.body);
    const { userId, verified } = await signUp(db, input);
    if (verified) return startSession(req, res, userId, 201);
    res.status(201).json({ verificationSent: true });
  });

  router.post('/verify', loginLimiter, async (req, res) => {
    const userId = await verifyEmail(db, parse(tokenSchema, req.body).token);
    await startSession(req, res, userId);
  });

  router.post('/verify/resend', loginLimiter, async (req, res) => {
    await resendVerification(db, parse(emailOnlySchema, req.body).email);
    res.status(204).end();
  });

  router.post('/password-reset/request', loginLimiter, async (req, res) => {
    await requestPasswordReset(db, parse(emailOnlySchema, req.body).email);
    res.status(204).end();
  });

  router.post('/password-reset/confirm', loginLimiter, async (req, res) => {
    const { token, newPassword } = parse(resetSchema, req.body);
    await resetPassword(db, token, newPassword);
    res.status(204).end();
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

  router.post('/tokens', requireSession, requireFeature(db, 'extension'), async (req, res) => {
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
    role: user.role,
    settings: resolveSettings(user.settings),
  };
}
