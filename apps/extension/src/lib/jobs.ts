import type { ApplicationStatus, Feature, FeatureState, WorkMode } from '@jt/shared';
import type { ExtractedJob, JobField } from '../adapters/types';
import { apiFetch } from './api';

/** The save form's fields (what the user sees and can edit before saving). */
export interface JobDraft {
  roleTitle: string;
  companyName: string;
  location: string;
  workMode: WorkMode | null;
  experienceAsked: string;
  salaryListed: string;
  jd: string;
  status: Extract<ApplicationStatus, 'saved' | 'applied'>;
}

export const draftFromJob = (job: ExtractedJob): JobDraft => ({
  roleTitle: job.roleTitle ?? '',
  companyName: job.companyName ?? '',
  location: job.location ?? '',
  workMode: job.workMode,
  experienceAsked: job.experienceAsked ?? '',
  salaryListed: job.salaryListed ?? '',
  jd: job.jd ?? '',
  status: 'saved',
});

export interface DuplicateMatch {
  id: string;
  companyName: string;
  roleTitle: string;
  status: string;
  appliedOn: string | null;
  jobUrl: string | null;
  level: 'exact' | 'likely' | 'hint';
}

export async function checkDuplicates(draft: Pick<JobDraft, 'companyName' | 'roleTitle'>, jobUrl: string): Promise<DuplicateMatch[]> {
  const { matches } = await apiFetch<{ matches: DuplicateMatch[] }>('/applications/check-duplicates', {
    intent: 'user',
    method: 'POST',
    json: { companyName: draft.companyName.trim(), roleTitle: draft.roleTitle.trim(), jobUrl },
  });
  return matches;
}

/** One-click save: a user action (X-JT-Intent: user → source 'extension', manual rules). */
export async function saveJob(job: ExtractedJob, draft: JobDraft, opts: { confirmDuplicate: boolean }): Promise<{ id: string }> {
  const text = (v: string) => v.trim() || null;
  const { application } = await apiFetch<{ application: { id: string } }>('/applications', {
    intent: 'user',
    method: 'POST',
    json: {
      companyName: draft.companyName.trim(),
      roleTitle: draft.roleTitle.trim(),
      location: text(draft.location),
      ...(draft.workMode ? { workMode: draft.workMode } : {}),
      experienceAsked: text(draft.experienceAsked),
      salaryListed: text(draft.salaryListed),
      ...(job.source ? { source: job.source } : {}),
      jobUrl: job.jobUrl,
      jd: draft.jd.trim() || undefined,
      status: draft.status,
      confirmDuplicate: opts.confirmDuplicate,
    },
  });
  return application;
}

export async function getFeatures(): Promise<Record<Feature, FeatureState>> {
  return (await apiFetch<{ features: Record<Feature, FeatureState> }>('/features', { intent: 'user' })).features;
}

/** AI fills only the fields the page readers missed (a user click, never automatic). */
export async function aiFill(job: ExtractedJob, title: string, text: string, missing: JobField[]) {
  return apiFetch<{ fields: Partial<Record<JobField, string | null>>; cached: boolean }>('/ai/extract-job', {
    intent: 'user',
    method: 'POST',
    json: { url: job.jobUrl, title, text, missing },
  });
}
