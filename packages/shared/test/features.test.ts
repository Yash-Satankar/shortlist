import { describe, expect, it } from 'vitest';
import { allFeatureStates, FEATURES, FEATURE_REQUIRES, featureOffMessage, featureState, isEnabled, userFeaturesSchema, type Feature } from '../src/features';

const all = (on: boolean) => Object.fromEntries(FEATURES.map((f) => [f, on])) as Record<Feature, boolean>;
const ON = all(true);

describe('featureState', () => {
  it('everything is on when the instance offers it, the user has not switched it off and there is a key', () => {
    expect(Object.values(allFeatureStates({ instance: ON, hasAiKey: true })).every((s) => s.enabled)).toBe(true);
  });

  it('a missing user switch means on; only an explicit false turns it off', () => {
    expect(isEnabled('extension', { instance: ON, user: {} })).toBe(true);
    expect(isEnabled('extension', { instance: ON, user: null })).toBe(true);
    expect(featureState('extension', { instance: ON, user: { extension: false } })).toEqual({ enabled: false, reason: 'user_off', blockedBy: null });
  });

  it('the instance wins: a user cannot switch on what the deployment does not offer', () => {
    expect(featureState('extension', { instance: { ...ON, extension: false }, user: { extension: true } })).toEqual({ enabled: false, reason: 'instance_off', blockedBy: null });
    expect(featureState('ai', { instance: {}, hasAiKey: true }).reason).toBe('instance_off');
  });

  describe('AI off', () => {
    const aiDependents = FEATURES.filter((f) => FEATURE_REQUIRES[f].includes('ai'));

    it('prep, chat and follow-up drafts depend on AI', () => {
      expect(aiDependents.sort()).toEqual(['chat', 'followup_drafts', 'prep']);
    });

    it('no key → AI and everything built on it is off with "add a key"; nothing else is affected', () => {
      const states = allFeatureStates({ instance: ON, hasAiKey: false });
      for (const f of ['ai', ...aiDependents] as Feature[]) expect(states[f]).toMatchObject({ enabled: false, reason: 'needs_ai_key' });
      for (const f of ['extension', 'portal_sync', 'email_intake'] as Feature[]) expect(states[f].enabled).toBe(true);
      expect(featureOffMessage('prep', states.prep)).toBe('Add an API key in Settings to enable this.');
    });

    it('AI switched off by the instance → dependents say so, naming AI', () => {
      const s = featureState('prep', { instance: { ...ON, ai: false }, hasAiKey: true });
      expect(s).toEqual({ enabled: false, reason: 'instance_off', blockedBy: 'ai' });
      expect(featureOffMessage('prep', s)).toBe('AI features isn’t available on this server.');
    });

    it('AI switched off by the user → dependents off, even with a key; email intake still runs (rule-based)', () => {
      const ctx = { instance: ON, user: { ai: false }, hasAiKey: true };
      expect(featureState('chat', ctx)).toEqual({ enabled: false, reason: 'user_off', blockedBy: 'ai' });
      expect(isEnabled('email_intake', ctx)).toBe(true);
    });

    it('a dependent can be off on its own while AI stays on', () => {
      const ctx = { instance: ON, user: { prep: false }, hasAiKey: true };
      expect(isEnabled('ai', ctx)).toBe(true);
      expect(isEnabled('prep', ctx)).toBe(false);
      expect(isEnabled('chat', ctx)).toBe(true);
    });
  });

  describe('extension off', () => {
    it('portal sync goes with it', () => {
      expect(featureState('portal_sync', { instance: ON, user: { extension: false } })).toEqual({ enabled: false, reason: 'user_off', blockedBy: 'extension' });
      expect(featureState('portal_sync', { instance: { ...ON, extension: false } }).reason).toBe('instance_off');
    });

    it('portal sync can be off alone while the extension still saves jobs', () => {
      const ctx = { instance: { ...ON, portal_sync: false } };
      expect(isEnabled('extension', ctx)).toBe(true);
      expect(isEnabled('portal_sync', ctx)).toBe(false);
    });

    it('needs no AI key', () => {
      expect(isEnabled('extension', { instance: ON, hasAiKey: false })).toBe(true);
    });
  });

  it('everything off on a bare instance', () => {
    expect(Object.values(allFeatureStates({ instance: {} })).every((s) => !s.enabled && s.reason === 'instance_off')).toBe(true);
  });
});

describe('userFeaturesSchema', () => {
  it('accepts known features with booleans only', () => {
    expect(userFeaturesSchema.parse({ prep: false })).toEqual({ prep: false });
    expect(userFeaturesSchema.safeParse({ teleport: true }).success).toBe(false);
    expect(userFeaturesSchema.safeParse({ prep: 'no' }).success).toBe(false);
  });
});
