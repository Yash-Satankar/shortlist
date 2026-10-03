import type { EventSource } from '@jt/shared';
import type { Request, RequestHandler } from 'express';
import { badRequest, forbidden } from '../lib/http';

/**
 * Extension requests must declare why they're writing:
 *   X-JT-Intent: user   the user clicked something (popup status, one-click save, edit)
 *                       → source 'extension', manual rules
 *   X-JT-Intent: auto   the extension detected it (submitted page, page sync)
 *                       → source 'extension_auto', automatic rules
 *
 * The token alone never decides. Each endpoint states which intents it accepts:
 * user intent only where a person is actually clicking, auto only where detection
 * makes sense. The web app (session cookie) is always a user, so it may only omit
 * the header or send 'user'.
 */
export const INTENT_HEADER = 'x-jt-intent';
export type Intent = 'user' | 'auto';

export interface IntentPolicy {
  user: boolean;
  auto: boolean;
}

export const USER_ONLY: IntentPolicy = { user: true, auto: false };
export const USER_OR_AUTO: IntentPolicy = { user: true, auto: true };
export const AUTO_ONLY: IntentPolicy = { user: false, auto: true };

function readIntent(req: Request): Intent | undefined {
  const raw = req.get(INTENT_HEADER)?.trim().toLowerCase();
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'user' || raw === 'auto') return raw;
  throw badRequest(`${INTENT_HEADER} must be "user" or "auto"`);
}

/**
 * Resolves the event source for a write, enforcing the endpoint's policy.
 * `webSource` lets the web app distinguish e.g. share-sheet captures ('share').
 */
export function resolveSource(req: Request, policy: IntentPolicy, webSource: EventSource = 'manual'): EventSource {
  const intent = readIntent(req);

  if (req.auth!.via === 'session') {
    if (intent === 'auto') throw badRequest('The web app cannot submit automatic signals');
    if (!policy.user) throw forbidden('This endpoint only accepts automatic signals');
    return webSource;
  }

  if (!intent) throw badRequest(`Extension requests must declare ${INTENT_HEADER}: user | auto`);
  if (intent === 'user') {
    if (!policy.user) throw forbidden('This endpoint does not accept user intent');
    return 'extension';
  }
  if (!policy.auto) throw forbidden('This endpoint does not accept automatic signals');
  return 'extension_auto';
}

/** Router-level guard for endpoints that are pure user edits (Q&A, contacts, undo...). */
export const requireUserIntent: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  try {
    resolveSource(req, USER_ONLY);
    next();
  } catch (err) {
    next(err);
  }
};
