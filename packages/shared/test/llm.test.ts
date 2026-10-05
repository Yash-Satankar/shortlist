import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, estimateCostUsd, LLM_PRICES_USD, LLM_TASKS, TASK_PROVIDER_PREFERENCE, userAiSettingsSchema } from '../src/llm';

describe('llm catalogue', () => {
  it('every default model has a price, so default usage always has a cost estimate', () => {
    for (const models of Object.values(DEFAULT_MODELS)) for (const m of Object.values(models)) expect(LLM_PRICES_USD[m], m).toBeDefined();
  });

  it('Together: a small model for structured reading, the 70B model for writing', () => {
    expect(DEFAULT_MODELS.together).toEqual({
      extraction: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      classification: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      prep: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      chat: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    });
  });

  it('every task has a full provider preference order', () => {
    for (const t of LLM_TASKS) expect(new Set(TASK_PROVIDER_PREFERENCE[t]).size).toBe(4);
  });

  it('estimateCostUsd: per-million pricing; unknown model → null', () => {
    expect(estimateCostUsd('claude-opus-5-5', 1_000_000, 100_000)).toBeCloseTo(6, 6); // $4 + $2
    expect(estimateCostUsd('claude-haiku-4-5', 1000, 200)).toBeCloseTo(0.002, 9);
    expect(estimateCostUsd('my-local-model', 1000, 1000)).toBeNull();
    expect(estimateCostUsd('my-local-model', 1_000_000, 0, { 'my-local-model': [0.5, 1] })).toBeCloseTo(0.5, 6);
  });

  it('settings: currency is a 3-letter code, cap and rate are bounded, models need a provider', () => {
    expect(userAiSettingsSchema.safeParse({ currency: 'INR', monthlyCap: 500, usdRate: 88 }).success).toBe(true);
    expect(userAiSettingsSchema.safeParse({ currency: 'rupees' }).success).toBe(false);
    expect(userAiSettingsSchema.safeParse({ monthlyCap: -1 }).success).toBe(false);
    expect(userAiSettingsSchema.safeParse({ usdRate: 0 }).success).toBe(false);
    expect(userAiSettingsSchema.safeParse({ models: { prep: { provider: 'groq', model: 'llama-3.3-70b-versatile' } } }).success).toBe(true);
    expect(userAiSettingsSchema.safeParse({ models: { prep: { provider: 'openai', model: 'x' } } }).success).toBe(false);
  });
});
