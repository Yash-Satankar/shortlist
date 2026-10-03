import { z } from 'zod';

/**
 * Per-user settings stored in users.settings (jsonb). Every field is optional:
 * a missing value falls back to the server's env default, so env stays the
 * single place to tune behaviour until a user overrides it in the UI.
 */
export const userSettingsSchema = z
  .object({
    ghostAfterDays: z.number().int().min(1).max(365),
    followUpAfterDays: z.number().int().min(1).max(365),
    timezone: z.string().min(1),
  })
  .partial();

export type UserSettings = z.infer<typeof userSettingsSchema>;
export type ResolvedUserSettings = Required<UserSettings>;
