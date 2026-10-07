import { apiOrigin, readState } from './config';

/**
 * Every request declares why it's made (the API enforces it per endpoint):
 *   user: the user clicked something (save, edit, connect, disconnect)
 *   auto: the extension detected it (submitted page, page sync)
 */
export type Intent = 'user' | 'auto';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiOptions {
  intent: Intent;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  json?: unknown;
  /** Use this token instead of the stored one (pairing: checking a pasted code). */
  token?: string;
}

export async function apiFetch<T>(path: string, opts: ApiOptions): Promise<T> {
  const [origin, state] = await Promise.all([apiOrigin(), readState()]);
  if (!origin) throw new ApiError(0, 'no_server', 'Enter your ShortList address first.');
  const token = opts.token ?? state.token;
  if (!token) throw new ApiError(401, 'not_paired', 'This browser is not paired yet');

  let res: Response;
  try {
    res = await fetch(`${origin}/api${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-JT-Intent': opts.intent,
        ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', `Can't reach ${new URL(origin).host}`);
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? res.statusText, body?.error?.details);
  }
  return body as T;
}
