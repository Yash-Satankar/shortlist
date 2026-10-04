import { formatProfileAnswer, PROFILE_ANSWER_FIELDS, type ProfileAnswerKey, type ProfileAnswerValues } from '@jt/shared';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { profiles } from '../db/schema';

export interface ResumeFile {
  name: string | null;
  size: number | null;
  mimeType: string | null;
  uploadedAt: Date | null;
}

export interface Profile extends ProfileAnswerValues {
  fullName: string | null;
  headline: string | null;
  resumeText: string | null;
  resumeUpdatedAt: Date | null;
  /** Last uploaded file's metadata (null if the text was only ever typed/pasted). */
  resumeFile: ResumeFile | null;
}

export type ProfilePatch = Partial<Omit<Profile, 'resumeUpdatedAt' | 'resumeFile'>>;

const EMPTY: Profile = {
  fullName: null,
  headline: null,
  totalExperienceYears: null,
  noticePeriodDays: null,
  relocation: null,
  currentLocation: null,
  currentCtc: null,
  expectedCtc: null,
  resumeText: null,
  resumeUpdatedAt: null,
  resumeFile: null,
};

export async function getProfile(db: DbOrTx, userId: string): Promise<Profile> {
  const row = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!row) return { ...EMPTY };
  return {
    fullName: row.fullName,
    headline: row.headline,
    totalExperienceYears: row.totalExperienceYears === null ? null : Number(row.totalExperienceYears),
    noticePeriodDays: row.noticePeriodDays,
    relocation: row.relocation,
    currentLocation: row.currentLocation,
    currentCtc: row.currentCtcEnc,
    expectedCtc: row.expectedCtcEnc,
    resumeText: row.resumeText,
    resumeUpdatedAt: row.resumeUpdatedAt,
    resumeFile: row.resumeUploadedAt
      ? { name: row.resumeFileName, size: row.resumeFileSize, mimeType: row.resumeMimeType, uploadedAt: row.resumeUploadedAt }
      : null,
  };
}

/** Maps API field names to columns (CTC columns are encrypted transparently). */
function toColumns(patch: ProfilePatch): Partial<typeof profiles.$inferInsert> {
  const set: Partial<typeof profiles.$inferInsert> = {};
  if (patch.fullName !== undefined) set.fullName = patch.fullName;
  if (patch.headline !== undefined) set.headline = patch.headline;
  if (patch.totalExperienceYears !== undefined) {
    set.totalExperienceYears = patch.totalExperienceYears === null ? null : String(patch.totalExperienceYears);
  }
  if (patch.noticePeriodDays !== undefined) set.noticePeriodDays = patch.noticePeriodDays;
  if (patch.relocation !== undefined) set.relocation = patch.relocation;
  if (patch.currentLocation !== undefined) set.currentLocation = patch.currentLocation;
  if (patch.currentCtc !== undefined) set.currentCtcEnc = patch.currentCtc;
  if (patch.expectedCtc !== undefined) set.expectedCtcEnc = patch.expectedCtc;
  if (patch.resumeText !== undefined) {
    set.resumeText = patch.resumeText;
    set.resumeUpdatedAt = new Date();
  }
  return set;
}

export async function updateProfile(db: DbOrTx, userId: string, patch: ProfilePatch): Promise<Profile> {
  const set = toColumns(patch);
  if (Object.keys(set).length) {
    await db.insert(profiles).values({ userId, ...set }).onConflictDoUpdate({ target: profiles.userId, set });
  }
  return getProfile(db, userId);
}

export interface ProfileAnswerItem {
  id: `profile:${ProfileAnswerKey}`;
  origin: 'profile';
  profileField: ProfileAnswerKey;
  question: string;
  answer: string;
  sensitive: boolean;
}

/** Library entries generated from the profile (read-only there; edit the profile instead). */
export function profileAnswerItems(profile: Profile): ProfileAnswerItem[] {
  return PROFILE_ANSWER_FIELDS.flatMap((f) => {
    const answer = formatProfileAnswer(f.key, profile[f.key]);
    return answer === null
      ? []
      : [{ id: `profile:${f.key}` as const, origin: 'profile' as const, profileField: f.key, question: f.question, answer, sensitive: f.sensitive }];
  });
}

/** Saves extracted resume text plus the uploaded file's metadata (never the file). */
export async function saveUploadedResume(
  db: DbOrTx,
  userId: string,
  input: { text: string; fileName: string | null; size: number; mimeType: string },
): Promise<Profile> {
  const now = new Date();
  const set = {
    resumeText: input.text,
    resumeUpdatedAt: now,
    resumeFileName: input.fileName,
    resumeFileSize: input.size,
    resumeMimeType: input.mimeType,
    resumeUploadedAt: now,
  };
  await db.insert(profiles).values({ userId, ...set }).onConflictDoUpdate({ target: profiles.userId, set });
  return getProfile(db, userId);
}
