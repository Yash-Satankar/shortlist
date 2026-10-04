import { parseRelocation, type ApplicationStatus } from '@jt/shared';
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
  Stats,
} from './types';

export const keys = {
  applications: (params: string) => ['applications', params] as const,
  application: (id: string) => ['application', id] as const,
  followUps: ['follow-ups'] as const,
  reviews: ['reviews'] as const,
  library: ['answer-library'] as const,
  profile: ['profile'] as const,
  stats: ['stats'] as const,
};

/** After any write that can change status/dates, list-style views are stale. */
function invalidateLists(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['applications'] });
  void qc.invalidateQueries({ queryKey: keys.followUps });
  void qc.invalidateQueries({ queryKey: keys.reviews });
  void qc.invalidateQueries({ queryKey: keys.stats });
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

/** Inbox numbers computed on the server (week = Monday 00:00 in the user's timezone). */
export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: () => api<Stats>('/stats') });

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
    mutationFn: (patch: Partial<Profile>) => {
      // The relocation row is one line of text ("Yes (Hyderabad preferred)"); the server
      // stores it as willing + preference.
      const { relocation, ...rest } = patch;
      const body = relocation === undefined ? rest : (() => {
        const r = parseRelocation(relocation);
        return { ...rest, relocationWilling: r.willing, relocationPreference: r.preference };
      })();
      return api<{ profile: Profile }>('/profile', { method: 'PATCH', json: body });
    },
    onSuccess: ({ profile }) => {
      qc.setQueryData(keys.profile, profile);
      void qc.invalidateQueries({ queryKey: keys.library });
    },
  });
}

export function useUploadResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api<{ profile: Profile; extracted: { kind: 'pdf' | 'docx'; pages?: number; characters: number } }>('/profile/resume', {
        method: 'POST',
        body: file,
        // The server stores the name/size/type as metadata (never the file itself).
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      }),
    onSuccess: ({ profile }) => qc.setQueryData(keys.profile, profile),
  });
}

// ---------------------------------------------------------------- answer library

export function useLibraryWrite() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: keys.library });
  return {
    create: useMutation({
      mutationFn: (item: { question: string; answer: string }) => api('/answer-library', { method: 'POST', json: item }),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: { id: string; question?: string; answer?: string }) =>
        api(`/answer-library/${id}`, { method: 'PATCH', json: patch }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/answer-library/${id}`, { method: 'DELETE' }),
      onSuccess: done,
    }),
  };
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) => api<void>('/auth/password', { method: 'POST', json: vars }),
  });
}

// ---------------------------------------------------------------- signed-in devices

export interface DeviceSession {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export const useSessions = () =>
  useQuery({ queryKey: ['sessions'], queryFn: async () => (await api<{ sessions: DeviceSession[] }>('/auth/sessions')).sessions });

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } | 'others') =>
      vars === 'others' ? api('/auth/sessions/revoke-others', { method: 'POST' }) : api<void>(`/auth/sessions/${vars.id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

// ---------------------------------------------------------------- recruiter contact

export interface ContactInput {
  name: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
}

/** Creates the application's recruiter contact, or updates it when one exists. */
export function useSaveRecruiter(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ContactInput & { id?: string }) =>
      id
        ? api(`/contacts/${id}`, { method: 'PATCH', json: input })
        : api(`/applications/${applicationId}/contacts`, { method: 'POST', json: { ...input, role: 'recruiter' } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.application(applicationId) }),
  });
}
