import { z } from 'zod';

/**
 * Optional features, in two layers:
 *   instance: what this deployment offers (env `FEATURE_*` plus its prerequisites, decided by the API);
 *   user:     what each user has switched on, within that (users.settings.features; missing = on).
 * Every surface asks `featureState`/`isEnabled`: the API (403 feature_disabled), background
 * jobs (don't run) and the web app and extension (surface hidden).
 */
export const FEATURES = ['ai', 'email_intake', 'extension', 'portal_sync', 'prep', 'chat', 'followup_drafts'] as const;
export type Feature = (typeof FEATURES)[number];

/** A feature is only on when everything it builds on is on. */
export const FEATURE_REQUIRES: Readonly<Record<Feature, readonly Feature[]>> = {
  ai: [],
  email_intake: [],
  extension: [],
  portal_sync: ['extension'],
  prep: ['ai'],
  chat: ['ai'],
  followup_drafts: ['ai'],
};

/** Features that call an LLM, so they also need a usable API key (BYOK). */
const NEEDS_AI_KEY: ReadonlySet<Feature> = new Set(['ai']);

export const FEATURE_LABELS: Readonly<Record<Feature, string>> = {
  ai: 'AI features',
  email_intake: 'Email updates',
  extension: 'Browser extension',
  portal_sync: 'Portal status sync',
  prep: 'Interview prep packs',
  chat: 'Ask my job search',
  followup_drafts: 'Follow-up drafts',
};

export type FeatureOffReason =
  | 'instance_off' // this deployment doesn't offer it
  | 'user_off' // the user switched it off
  | 'needs_ai_key'; // no API key the user may use

export interface FeatureState {
  enabled: boolean;
  /** Why it's off, from the root cause (e.g. prep is off because AI has no key → needs_ai_key). */
  reason: FeatureOffReason | null;
  /** The feature that caused it, when a requirement is off. */
  blockedBy: Feature | null;
}

export interface FeatureContext {
  instance: Readonly<Partial<Record<Feature, boolean>>>;
  user?: Readonly<Partial<Record<Feature, boolean>>> | null;
  /** True when the user has an AI key they may use (their own, or the instance key for an admin). */
  hasAiKey?: boolean;
}

export function featureState(feature: Feature, ctx: FeatureContext): FeatureState {
  if (!ctx.instance[feature]) return { enabled: false, reason: 'instance_off', blockedBy: null };
  if (ctx.user?.[feature] === false) return { enabled: false, reason: 'user_off', blockedBy: null };
  for (const req of FEATURE_REQUIRES[feature]) {
    const s = featureState(req, ctx);
    if (!s.enabled) return { enabled: false, reason: s.reason, blockedBy: s.blockedBy ?? req };
  }
  if (NEEDS_AI_KEY.has(feature) && !ctx.hasAiKey) return { enabled: false, reason: 'needs_ai_key', blockedBy: null };
  return { enabled: true, reason: null, blockedBy: null };
}

export const isEnabled = (feature: Feature, ctx: FeatureContext): boolean => featureState(feature, ctx).enabled;

export function allFeatureStates(ctx: FeatureContext): Record<Feature, FeatureState> {
  return Object.fromEntries(FEATURES.map((f) => [f, featureState(f, ctx)])) as Record<Feature, FeatureState>;
}

/** Shown wherever a hidden feature needs explaining. */
export function featureOffMessage(feature: Feature, state: FeatureState): string {
  const name = FEATURE_LABELS[state.blockedBy ?? feature];
  switch (state.reason) {
    case 'needs_ai_key':
      return 'Add an API key in Settings to enable this.';
    case 'user_off':
      return `${name} is switched off in Settings.`;
    case 'instance_off':
      return `${name} isn’t available on this server.`;
    default:
      return '';
  }
}

/** The user's switches (PATCH /api/features). Only `false` is stored meaningfully; missing = on. */
export const userFeaturesSchema = z.partialRecord(z.enum(FEATURES), z.boolean());
export type UserFeatures = z.infer<typeof userFeaturesSchema>;
