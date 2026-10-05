import { allFeatureStates, FEATURES, featureOffMessage, featureState, type Feature, type FeatureContext, type FeatureState } from '@jt/shared';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import type { DbOrTx } from '../db/client';
import { users } from '../db/schema';
import { HttpError } from '../lib/http';
import { env, type Env } from './env';

export interface InstanceFeature {
  offered: boolean;
  /** Why, in env terms, for the startup summary. */
  why: string;
}

const ENV_FLAG: Record<Feature, keyof Env> = {
  ai: 'FEATURE_AI',
  email_intake: 'FEATURE_EMAIL_INTAKE',
  extension: 'FEATURE_EXTENSION',
  portal_sync: 'FEATURE_PORTAL_SYNC',
  prep: 'FEATURE_PREP',
  chat: 'FEATURE_CHAT',
  followup_drafts: 'FEATURE_FOLLOWUP_DRAFTS',
};

/**
 * The instance layer: the env switch plus anything the feature needs from this deployment.
 * A feature whose prerequisites are missing is not offered, and the summary says why.
 */
export function instanceFeatures(e: Env = env()): Record<Feature, InstanceFeature> {
  const out = {} as Record<Feature, InstanceFeature>;
  for (const f of FEATURES) {
    const flag = ENV_FLAG[f];
    out[f] = e[flag] ? { offered: true, why: `${flag}=true` } : { offered: false, why: `${flag}=false` };
  }
  if (out.email_intake.offered) {
    out.email_intake = { offered: false, why: `FEATURE_EMAIL_INTAKE=true, but email intake (${e.EMAIL_INTAKE_MODE}) isn’t available in this version yet` };
  }
  if (out.ai.offered) out.ai.why += ' (each user adds their own API key)';
  return out;
}

const offeredMap = (e?: Env) => Object.fromEntries(Object.entries(instanceFeatures(e)).map(([f, s]) => [f, s.offered])) as Record<Feature, boolean>;

/**
 * Whether the user has an AI key they may use. BYOK keys arrive with the LLM layer
 * (Phase 2 step 5); until then nobody has one, so AI features stay off.
 */
async function hasUsableAiKey(_db: DbOrTx, _userId: string): Promise<boolean> {
  return false;
}

export async function featureContext(db: DbOrTx, userId: string): Promise<FeatureContext> {
  const [row] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  return { instance: offeredMap(), user: row?.settings?.features ?? {}, hasAiKey: await hasUsableAiKey(db, userId) };
}

export async function userFeatureStates(db: DbOrTx, userId: string): Promise<Record<Feature, FeatureState>> {
  return allFeatureStates(await featureContext(db, userId));
}

export const featureDisabled = (feature: Feature, state: FeatureState) =>
  new HttpError(403, featureOffMessage(feature, state), 'feature_disabled', { feature, reason: state.reason, blockedBy: state.blockedBy });

/** Throws 403 feature_disabled unless the feature is on for this user. For services and background jobs. */
export async function assertFeature(db: DbOrTx, userId: string, feature: Feature): Promise<void> {
  const state = featureState(feature, await featureContext(db, userId));
  if (!state.enabled) throw featureDisabled(feature, state);
}

/** Route guard (after requireAuth). */
export function requireFeature(db: DbOrTx, feature: Feature): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next();
    assertFeature(db, req.auth.userId, feature).then(() => next(), next);
  };
}

/** One line per feature for the startup log: on, or off and why. */
export function featureSummary(e?: Env): string[] {
  return Object.entries(instanceFeatures(e)).map(([f, s]) => `${s.offered ? 'on ' : 'off'}  ${f.padEnd(16)} ${s.why}`);
}
