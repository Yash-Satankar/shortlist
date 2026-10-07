import type { ResolvedUserSettings } from '@jt/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { setDisplayTimezone } from '../lib/format';

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  settings: ResolvedUserSettings;
}

const ME_KEY = ['auth', 'me'] as const;

/** Public server settings for signed-out screens; falls back to the defaults until loaded. */
export function usePublicConfig() {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: () => api<PublicConfig>('/config'),
    staleTime: Infinity,
  });
  return { sessionTtlDays: data?.sessionTtlDays ?? 30, signupMode: data?.signupMode ?? 'closed', needsSetup: data?.needsSetup ?? false, emailEnabled: data?.emailEnabled ?? false, demo: data?.demo ?? false, version: data?.version ?? '', sourceUrl: data?.sourceUrl ?? '', loaded: Boolean(data) };
}

export interface PublicConfig {
  sessionTtlDays: number;
  signupMode: 'closed' | 'invite' | 'open';
  /** No accounts yet: show the first-run setup. */
  needsSetup: boolean;
  /** Email sending configured: "Forgot password?" works. */
  emailEnabled: boolean;
  /** The public demo (fictional data, read-only). */
  demo?: boolean;
  version?: string;
  /** Where this server's source code is (AGPL-3.0). */
  sourceUrl?: string;
}

/**
 * Signed-out actions that may sign you in (setup, sign-up with an invite, confirming your email):
 * when the server returns a user, they're the current user from then on.
 */
export function useAuthAction<V>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: V) => api<{ user?: CurrentUser; verificationSent?: boolean } | undefined>(path, { method: 'POST', json: input }),
    onSuccess: (res) => {
      if (res?.user) {
        setDisplayTimezone(res.user.settings.timezone);
        void qc.invalidateQueries({ queryKey: ['config'] });
        qc.setQueryData(ME_KEY, res.user);
      }
    },
  });
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const { user } = await api<{ user: CurrentUser }>('/auth/me');
        setDisplayTimezone(user.settings.timezone);
        return user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    // A server that's asleep (free hosting) or restarting: keep trying for about a minute and a
    // half instead of showing an error. A real answer (401 = signed out, 4xx) stops at once.
    retry: (count, err) => count < 18 && !(err instanceof ApiError && err.status > 0 && err.status < 500),
    retryDelay: 5000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<{ user: CurrentUser }>('/auth/login', { method: 'POST', json: input }),
    onSuccess: ({ user }) => {
      setDisplayTimezone(user.settings.timezone);
      qc.setQueryData(ME_KEY, user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}
