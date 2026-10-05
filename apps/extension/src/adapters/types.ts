import type { ApplicationSource, WorkMode } from '@jt/shared';
import type { SiteId } from '../lib/sites';

/** Where a field's value came from, best first. Lower tiers get a "check this" hint in the save form. */
export type FieldOrigin = 'site' | 'json-ld' | 'meta' | 'heuristic';

/** A job read from the page you're viewing. Field names match the API's create-application input. */
export interface ExtractedJob {
  roleTitle: string | null;
  companyName: string | null;
  location: string | null;
  workMode: WorkMode | null;
  experienceAsked: string | null;
  salaryListed: string | null;
  /** Job description as plain text (paragraphs and bullets kept). */
  jd: string | null;
  /** Canonical job URL (tracking stripped) and the platform's id, when known. */
  jobUrl: string;
  externalId: string | null;
  source: ApplicationSource | null;
  /** LinkedIn "Easy Apply" etc.: the application happens on this site. */
  applyOnSite: boolean | null;
  origins: Partial<Record<JobField, FieldOrigin>>;
  /** Which adapter produced it ('generic' for unknown sites). */
  adapter: SiteId | 'generic';
  /** Required fields still empty: the save form asks for them (or AI fills them, when enabled). */
  missing: JobField[];
}

export type JobField = 'roleTitle' | 'companyName' | 'location' | 'workMode' | 'experienceAsked' | 'salaryListed' | 'jd';

export const REQUIRED_FIELDS: JobField[] = ['roleTitle', 'companyName', 'jd'];

export type PartialJob = Partial<Pick<ExtractedJob, JobField | 'applyOnSite' | 'externalId'>>;

export interface SiteAdapter {
  id: SiteId;
  /** Is this rendered page a single job posting (vs a search list, profile, feed…)? */
  isJobPage(doc: Document, url: URL): boolean;
  /** Read the job from the rendered DOM. Missing pieces are fine; the generic reader fills gaps. */
  extract(doc: Document, url: URL): PartialJob;
}
