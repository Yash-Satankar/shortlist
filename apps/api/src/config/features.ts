import { allFeatureStates, FEATURES, featureOffMessage, featureState, type Feature, type FeatureContext, type FeatureState } from '@jt/shared';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import type { DbOrTx } from '../db/client';
import { users } from '../db/schema';
import { HttpError } from '../lib/http';
import { availableKeys } from '../llm/keys';
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
    const missing =
      e.EMAIL_INTAKE_MODE === 'imap'
        ? (['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD'] as const).filter((k) => !e[k])
        : (['INBOUND_EMAIL_DOMAIN', 'INBOUND_WEBHOOK_USER', 'INBOUND_WEBHOOK_PASSWORD'] as const).filter((k) => !e[k]);
    out.email_intake = missing.length
      ? { offered: false, why: `FEATURE_EMAIL_INTAKE=true (${e.EMAIL_INTAKE_MODE}), but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set` }
      : { offered: true, why: `FEATURE_EMAIL_INTAKE=true (${e.EMAIL_INTAKE_MODE})` };
  }
  if (out.ai.offered) out.ai.why += ' (each user adds their own API key)';
  return out;
}

const offeredMap = (e?: Env) => Object.fromEntries(Object.entries(instanceFeatures(e)).map(([f, s]) => [f, s.offered])) as Record<Feature, boolean>;

/** Whether the user has an AI key they may use: their own, or (admins) an instance key. */
async function hasUsableAiKey(db: DbOrTx, userId: string): Promise<boolean> {
  return (await availableKeys(db, userId)).size > 0;
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
