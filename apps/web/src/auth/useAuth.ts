import type { ResolvedUserSettings } from '@jt/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { setDisplayTimezone } from '../lib/format';

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  settings: ResolvedUserSettings;
}

const ME_KEY = ['auth', 'me'] as const;

/** Public server settings for signed-out screens; falls back to the defaults until loaded. */
export function usePublicConfig() {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ sessionTtlDays: number }>('/config'),
    staleTime: Infinity,
  });
  return { sessionTtlDays: data?.sessionTtlDays ?? 30 };
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
