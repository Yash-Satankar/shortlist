import { z } from 'zod';
import { userFeaturesSchema } from './features';
import { userAiSettingsSchema } from './llm';

/**
 * Per-user settings stored in users.settings (jsonb). Every field is optional:
 * a missing value falls back to the server's env default, so env stays the
 * single place to tune behaviour until a user overrides it in the UI.
 */
export const userSettingsSchema = z
  .object({
    ghostAfterDays: z.number().int().min(1).max(365),
    followUpAfterDays: z.number().int().min(1).max(365),
    postInterviewFollowUpDays: z.number().int().min(1).max(365),
    timezone: z.string().min(1),
    /** Per-user feature switches within what the instance offers (missing = on). */
    features: userFeaturesSchema,
    /** AI: model per task, monthly cap, currency (users.settings.ai). */
    ai: userAiSettingsSchema,
  })
  .partial();

export type UserSettings = z.infer<typeof userSettingsSchema>;
export type ResolvedUserSettings = Required<UserSettings>;
