import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env';
import type { Db } from '../db/client';
import { forbidden, unauthorized } from '../lib/http';
import { API_TOKEN_PREFIX, validateApiToken, validateSession } from './service';

export interface AuthContext {
  userId: string;
  via: 'session' | 'token';
  sessionId?: string;
  tokenId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** `__Host-` prefix in production: cookie is locked to this exact origin, HTTPS-only. */
export function sessionCookieName(): string {
  const { NODE_ENV, SESSION_COOKIE_NAME } = env();
  return NODE_ENV === 'production' ? `__Host-${SESSION_COOKIE_NAME}` : SESSION_COOKIE_NAME;
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires,
  };
}

/** Resolves req.auth from a bearer API token or the session cookie. Never rejects by itself. */
export function authenticate(db: Db): RequestHandler {
  return async (req, res, next) => {
    const header = req.get('authorization');
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      const row = token.startsWith(API_TOKEN_PREFIX) ? await validateApiToken(db, token) : null;
      if (!row) return next(unauthorized('Invalid or revoked API token'));
      req.auth = { userId: row.userId, via: 'token', tokenId: row.id };
      return next();
    }

    const cookie: unknown = req.cookies?.[sessionCookieName()];
    if (typeof cookie === 'string' && cookie) {
      const session = await validateSession(db, cookie);
      if (session) {
        req.auth = { userId: session.userId, via: 'session', sessionId: session.id };
        res.cookie(sessionCookieName(), cookie, sessionCookieOptions(session.expiresAt));
      } else {
        res.clearCookie(sessionCookieName(), { path: '/' });
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.auth ? undefined : unauthorized());
};

export const requireSession: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  next(req.auth.via === 'session' ? undefined : forbidden('This action requires signing in on the web app'));
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie-based requests. Web and API share one origin, so any
 * state-changing request must come from that origin. Bearer-token requests
 * (extension) carry no ambient credentials and are exempt.
 */
export function sameOriginGuard(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || req.get('authorization')?.startsWith('Bearer ')) return next();
  const origin = req.get('origin');
  if (origin) return next(origin === new URL(env().APP_ORIGIN).origin ? undefined : forbidden('Cross-origin request blocked'));
  // Some browsers omit Origin on same-origin requests; fall back to Fetch Metadata.
  return next(req.get('sec-fetch-site') === 'same-origin' ? undefined : forbidden('Missing Origin header'));
}
