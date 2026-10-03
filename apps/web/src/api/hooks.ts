import type { ApplicationStatus } from '@jt/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Answer,
  ApplicationDetail,
  ApplicationListItem,
  DuplicateMatch,
  FollowUps,
  LibraryItem,
  Profile,
  ReviewItem,
} from './types';

export const keys = {
  applications: (params: string) => ['applications', params] as const,
  application: (id: string) => ['application', id] as const,
  followUps: ['follow-ups'] as const,
  reviews: ['reviews'] as const,
  library: ['answer-library'] as const,
  profile: ['profile'] as const,
};

/** After any write that can change status/dates, list-style views are stale. */
function invalidateLists(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['applications'] });
  void qc.invalidateQueries({ queryKey: keys.followUps });
  void qc.invalidateQueries({ queryKey: keys.reviews });
}

/** Most writes return the fresh application detail: put it straight in the cache. */
function useApplicationWrite<V>(id: string, fn: (vars: V) => Promise<{ application: ApplicationDetail }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: ({ application }) => {
      qc.setQueryData(keys.application(id), application);
      invalidateLists(qc);
    },
  });
}

// ---------------------------------------------------------------- reads

export function useApplications(params: URLSearchParams) {
  const qs = params.toString();
  return useQuery({
    queryKey: keys.applications(qs),
    queryFn: () => api<{ items: ApplicationListItem[]; total: number }>(`/applications?${qs}`),
    placeholderData: keepPreviousData,
  });
}

export function useApplication(id: string) {
  return useQuery({
    queryKey: keys.application(id),
    queryFn: async () => (await api<{ application: ApplicationDetail }>(`/applications/${id}`)).application,
  });
}

export const useFollowUps = () => useQuery({ queryKey: keys.followUps, queryFn: () => api<FollowUps>('/follow-ups') });

export const useReviews = () =>
  useQuery({ queryKey: keys.reviews, queryFn: async () => (await api<{ items: ReviewItem[] }>('/reviews')).items });

export const useLibrary = () =>
  useQuery({ queryKey: keys.library, queryFn: async () => (await api<{ items: LibraryItem[] }>('/answer-library')).items });

export const useProfile = () =>
  useQuery({ queryKey: keys.profile, queryFn: async () => (await api<{ profile: Profile }>('/profile')).profile });

// ---------------------------------------------------------------- application writes

export function useChangeStatus(id: string) {
  return useApplicationWrite(id, (vars: { status: ApplicationStatus; note?: string }) =>
    api(`/applications/${id}/status`, { method: 'POST', json: vars }),
  );
}

export function useUndo(id: string) {
  return useApplicationWrite(id, (eventId: string) => api(`/applications/${id}/events/${eventId}/undo`, { method: 'POST' }));
}

export function useReview(id: string) {
  return useApplicationWrite(id, (vars: { eventId: string; decision: 'accept' | 'dismiss' }) =>
    api(`/applications/${id}/events/${vars.eventId}/review`, { method: 'POST', json: { decision: vars.decision } }),
  );
}

export function useUpdateApplication(id: string) {
  return useApplicationWrite(id, (patch: Record<string, unknown>) => api(`/applications/${id}`, { method: 'PATCH', json: patch }));
}

export function useAddJd(id: string) {
  return useApplicationWrite(id, (content: string) => api(`/applications/${id}/jd`, { method: 'POST', json: { content } }));
}

export function useReplaceAnswers(id: string) {
  return useApplicationWrite(id, (answers: Array<Pick<Answer, 'question' | 'answer'> & { libraryItemId?: string | null }>) =>
    api(`/applications/${id}/answers`, { method: 'PUT', json: { answers } }),
  );
}

export function useDeleteApplication(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/applications/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: keys.application(id) });
      invalidateLists(qc);
    },
  });
}

/** Review accept/dismiss from the inbox, where several applications are involved. */
export function useReviewAny() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { applicationId: string; eventId: string; decision: 'accept' | 'dismiss' }) =>
      api<{ application: ApplicationDetail }>(`/applications/${vars.applicationId}/events/${vars.eventId}/review`, {
        method: 'POST',
        json: { decision: vars.decision },
      }),
    onSuccess: ({ application }) => {
      qc.setQueryData(keys.application(application.id), application);
      invalidateLists(qc);
    },
  });
}

/** Status change / field patch from list-style screens (inbox, board). */
export function useQuickUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status?: ApplicationStatus; patch?: Record<string, unknown> }) =>
      vars.status
        ? api<{ application: ApplicationDetail }>(`/applications/${vars.id}/status`, { method: 'POST', json: { status: vars.status } })
        : api<{ application: ApplicationDetail }>(`/applications/${vars.id}`, { method: 'PATCH', json: vars.patch }),
    onSuccess: ({ application }) => {
      qc.setQueryData(keys.application(application.id), application);
      invalidateLists(qc);
    },
  });
}

// ---------------------------------------------------------------- create

export interface CreateApplicationInput {
  companyName: string;
  roleTitle: string;
  jobUrl?: string | null;
  location?: string | null;
  status?: ApplicationStatus;
  jd?: string;
  via?: 'manual' | 'share';
  confirmDuplicate?: boolean;
}

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApplicationInput) =>
      api<{ application: ApplicationDetail; hints: DuplicateMatch[] }>('/applications', { method: 'POST', json: input }),
    onSuccess: ({ application }) => {
      qc.setQueryData(keys.application(application.id), application);
      invalidateLists(qc);
    },
  });
}

export function checkDuplicates(input: { companyName: string; roleTitle: string; jobUrl?: string | null }) {
  return api<{ matches: DuplicateMatch[] }>('/applications/check-duplicates', { method: 'POST', json: input });
}

// ---------------------------------------------------------------- profile

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Profile>) => api<{ profile: Profile }>('/profile', { method: 'PATCH', json: patch }),
    onSuccess: ({ profile }) => {
      qc.setQueryData(keys.profile, profile);
      void qc.invalidateQueries({ queryKey: keys.library });
    },
  });
}
