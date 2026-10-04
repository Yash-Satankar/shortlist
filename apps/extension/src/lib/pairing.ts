import { ApiError, apiFetch } from './api';
import { clearConnection, writeState, type Account } from './config';

/** Checks a pasted pairing code against the API, then stores it. Nothing is stored if it fails. */
export async function connect(code: string): Promise<Account> {
  const token = code.trim();
  if (!/^jt_[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new ApiError(400, 'bad_code', 'That doesn’t look like a pairing code. Copy it again from Settings → Browser extension.');
  }
  try {
    const { user } = await apiFetch<{ user: Account }>('/auth/me', { intent: 'user', token });
    const account = { email: user.email, name: user.name };
    await writeState({ token, account });
    return account;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw new ApiError(401, 'bad_code', 'That pairing code isn’t valid (it may have been revoked). Create a new one in Settings.');
    }
    throw err;
  }
}

/** Revokes this browser's token on the server (best effort), then forgets it locally. */
export async function disconnect(): Promise<{ revokedOnServer: boolean }> {
  let revokedOnServer = true;
  try {
    await apiFetch('/auth/tokens/self/revoke', { intent: 'user', method: 'POST' });
  } catch (err) {
    // Already revoked (401) counts as done; offline means it still needs revoking in Settings.
    revokedOnServer = err instanceof ApiError && err.status === 401;
  }
  await clearConnection();
  return { revokedOnServer };
}
