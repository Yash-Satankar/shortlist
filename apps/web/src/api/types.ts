import type {
  ApplicationSource,
  ApplicationStatus,
  ContactRole,
  EventDisposition,
  EventSource,
  FollowUpReason,
  ProfileAnswerKey,
  SignalConfidence,
  WorkMode,
} from '@jt/shared';

/** Response shapes of the API (dates arrive as ISO strings). */

export interface ApplicationSummary {
  id: string;
  companyId: string;
  roleTitle: string;
  location: string | null;
  workMode: WorkMode;
  workModeDetail: string | null;
  experienceAsked: string | null;
  source: ApplicationSource;
  sourceDetail: string | null;
  jobUrl: string | null;
  status: ApplicationStatus;
  statusChangedAt: string;
  appliedOn: string | null;
  followUpOn: string | null;
  lastActivityAt: string;
  notes: string | null;
  archivedAt: string | null;
  expectedCtc: string | null;
  salaryListed: string | null;
  salaryMinLpa: number | null;
  salaryMaxLpa: number | null;
  noticePeriodDays: number | null;
  willingToRelocate: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationListItem extends ApplicationSummary {
  companyName: string;
  hasJd: boolean;
  pendingReviews: number;
}

export interface TimelineEvent {
  id: string;
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  source: EventSource;
  disposition: EventDisposition;
  reason: string | null;
  /** Label the UI renders (derived server-side from confidenceScore and the threshold). */
  confidence: SignalConfidence | null;
  /** Raw 0–1 score; null for manual/import events. */
  confidenceScore: number | null;
  occurredAt: string;
  recordedAt: string;
  note: string | null;
  evidenceType: string | null;
  evidenceId: string | null;
  revertsEventId: string | null;
  revertedAt: string | null;
}

export interface JdMeta {
  id: string;
  source: EventSource;
  sourceUrl: string | null;
  capturedAt: string;
  length: number;
}

export interface Answer {
  id: string;
  question: string;
  answer: string;
  libraryItemId: string | null;
  sortOrder: number;
}

export interface Contact {
  id: string;
  role: ContactRole;
  name: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
}

export interface ApplicationDetail extends ApplicationSummary {
  company: { id: string; name: string; website: string | null; careersUrl: string | null } | null;
  jd: (JdMeta & { content: string }) | null;
  jdHistory: JdMeta[];
  timeline: TimelineEvent[];
  answers: Answer[];
  contacts: Contact[];
}

export interface DuplicateMatch {
  id: string;
  companyName: string;
  roleTitle: string;
  status: ApplicationStatus;
  appliedOn: string | null;
  jobUrl: string | null;
  level: 'exact' | 'likely' | 'hint';
  roleSimilarity: number;
}

export interface FollowUpItem {
  id: string;
  companyName: string;
  roleTitle: string;
  status: ApplicationStatus;
  appliedOn: string | null;
  followUpOn: string | null;
  lastActivityAt: string;
  jobUrl: string | null;
  daysSinceActivity: number;
}

export interface FollowUps {
  settings: { followUpAfterDays: number; postInterviewFollowUpDays: number; ghostAfterDays: number; today: string };
  followUps: Array<FollowUpItem & { reason: FollowUpReason }>;
  ghostSuggestions: FollowUpItem[];
}

export interface ReviewItem {
  event: TimelineEvent;
  application: { id: string; roleTitle: string; status: ApplicationStatus };
  company: { id: string; name: string };
}

export type LibraryItem =
  | { id: string; origin: 'library'; question: string; answer: string; category: string | null; sortOrder: number }
  | { id: `profile:${ProfileAnswerKey}`; origin: 'profile'; profileField: ProfileAnswerKey; question: string; answer: string; sensitive: boolean };

export interface Profile {
  fullName: string | null;
  headline: string | null;
  totalExperienceYears: number | null;
  noticePeriodDays: number | null;
  relocation: string | null;
  currentLocation: string | null;
  currentCtc: string | null;
  expectedCtc: string | null;
  resumeText: string | null;
  resumeUpdatedAt: string | null;
}
