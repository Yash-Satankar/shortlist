import { desc, lt } from 'drizzle-orm';
import { env } from '../config/env';
import type { DbOrTx } from '../db/client';
import { appErrors } from '../db/schema';
import { logger } from '../logger';

/**
 * The error log behind Settings → Recent errors (admins). Chosen over a hosted error tracker so
 * no third party ever receives users' data, and so self-hosters get it with no account: errors
 * are already in the structured logs; this keeps the recent ones where the admin can see them.
 */

/** Masks what must never be stored: email addresses, bearer/API keys and other long tokens. */
export function sanitizeMessage(message: string): string {
  return message
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(?:sk|gsk|tgp|pk|rk|xox[bp])[-_][A-Za-z0-9_-]{6,}/g, '[key]')
    .replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, '[token]')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[database url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/** "src/ask/search.ts:120" from the first stack frame inside the app (not node_modules). */
export function firstAppFrame(stack: string | undefined): string | null {
  for (const line of (stack ?? '').split('\n').slice(1)) {
    if (line.includes('node_modules') || line.includes('node:')) continue;
    const m = /(?:apps[\\/]api[\\/])?((?:src|dist)[\\/][^\s:()]+):(\d+)/.exec(line);
    if (m) return `${m[1]!.replace(/\\/g, '/')}:${m[2]}`;
  }
  return null;
}

export interface ErrorEntry {
  kind: 'request' | 'job';
  where: string;
  status?: number | null;
  error: unknown;
  requestId?: string | null;
  userId?: string | null;
}

/** Records an error. Never throws: logging must not turn one failure into two. */
export async function recordError(db: DbOrTx, entry: ErrorEntry): Promise<void> {
  const err = entry.error instanceof Error ? entry.error : new Error(String(entry.error));
  try {
    await db.insert(appErrors).values({
      kind: entry.kind,
      where: entry.where.slice(0, 200),
      status: entry.status ?? null,
      errorName: err.name.slice(0, 100),
      message: sanitizeMessage(err.message || '(no message)'),
      location: firstAppFrame(err.stack),
      requestId: entry.requestId ?? null,
      userId: entry.userId ?? null,
    });
  } catch (e) {
    logger.warn({ err: e }, 'Could not record an error in app_errors');
  }
}

export async function recentErrors(db: DbOrTx, limit = 100) {
  return db
    .select({ id: appErrors.id, kind: appErrors.kind, where: appErrors.where, status: appErrors.status, errorName: appErrors.errorName, message: appErrors.message, location: appErrors.location, requestId: appErrors.requestId, createdAt: appErrors.createdAt })
    .from(appErrors)
    .orderBy(desc(appErrors.createdAt))
    .limit(limit);
}

export async function purgeOldErrors(db: DbOrTx): Promise<number> {
  const cutoff = new Date(Date.now() - env().ERROR_LOG_RETENTION_DAYS * 86_400_000);
  return (await db.delete(appErrors).where(lt(appErrors.createdAt, cutoff)).returning({ id: appErrors.id })).length;
}

/** "POST /api/applications/:id/status": the matched route pattern, never ids or query strings. */
export function routePattern(method: string, baseUrl: string, routePath: string | undefined, url: string): string {
  const pathPart = routePath ? `${baseUrl}${routePath}` : url.split('?')[0]!.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
  return `${method} ${pathPart}`;
}
