import { z } from 'zod';
import type { Feature } from './features';

/**
 * AI is bring-your-own-key: each user adds keys for the providers they want, then picks a
 * model per task. Self-hosters may also set instance keys in env; those serve admin accounts only.
 */
export const LLM_PROVIDERS = ['anthropic', 'groq', 'together', 'openai_compatible'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  groq: 'Groq',
  together: 'Together AI',
  openai_compatible: 'OpenAI-compatible',
};

/** OpenAI-style chat endpoints; openai_compatible takes the user's own base URL. */
export const LLM_BASE_URLS: Partial<Record<LlmProvider, string>> = {
  groq: 'https://api.groq.com/openai/v1',
  together: 'https://api.together.xyz/v1',
};

export const LLM_TASKS = ['extraction', 'classification', 'prep', 'chat'] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

export const LLM_TASK_LABELS: Record<LlmTask, string> = {
  extraction: 'Reading job pages',
  classification: 'Sorting emails',
  prep: 'Prep packs',
  chat: 'Chat and drafts',
};

/** The feature a task serves (it only runs when that feature is on). */
export const LLM_TASK_FEATURE: Record<LlmTask, Feature> = {
  extraction: 'ai',
  classification: 'email_intake',
  prep: 'prep',
  chat: 'chat',
};

/** Defaults per provider and task: small fast models for extraction/classification, strong ones for writing. */
export const DEFAULT_MODELS: Record<Exclude<LlmProvider, 'openai_compatible'>, Record<LlmTask, string>> = {
  anthropic: { extraction: 'claude-haiku-4-5', classification: 'claude-haiku-4-5', prep: 'claude-opus-5-5', chat: 'claude-opus-5-5' },
  groq: { extraction: 'llama-3.1-8b-instant', classification: 'llama-3.1-8b-instant', prep: 'llama-3.3-70b-versatile', chat: 'llama-3.3-70b-versatile' },
  together: {
    extraction: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    classification: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    prep: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    chat: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
};

/** Which provider a task prefers when the user has several keys and hasn't chosen. */
export const TASK_PROVIDER_PREFERENCE: Record<LlmTask, LlmProvider[]> = {
  extraction: ['groq', 'anthropic', 'together', 'openai_compatible'],
  classification: ['groq', 'anthropic', 'together', 'openai_compatible'],
  prep: ['anthropic', 'groq', 'together', 'openai_compatible'],
  chat: ['anthropic', 'groq', 'together', 'openai_compatible'],
};

/**
 * USD per million tokens [input, output], for the cost estimate. Unknown models show
 * "cost unknown" (self-hosters can add prices with LLM_PRICES_JSON).
 */
export const LLM_PRICES_USD: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
  'llama-3.1-8b-instant': [0.05, 0.08],
  'llama-3.3-70b-versatile': [0.59, 0.79],
  'meta-llama/Llama-3.3-70B-Instruct-Turbo': [0.88, 0.88],
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, prices: Record<string, [number, number]> = LLM_PRICES_USD): number | null {
  const p = prices[model];
  if (!p) return null;
  return (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000;
}

const modelChoice = z.object({ provider: z.enum(LLM_PROVIDERS), model: z.string().trim().min(1).max(200) });
export type ModelChoice = z.infer<typeof modelChoice>;

/** Per-user AI settings (users.settings.ai). Missing values fall back to env defaults. */
export const userAiSettingsSchema = z
  .object({
    models: z.partialRecord(z.enum(LLM_TASKS), modelChoice),
    /** Monthly spend cap in `currency`; calls stop with a clear message once reached. */
    monthlyCap: z.number().min(0).max(1_000_000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    /** How many units of `currency` one US dollar buys (for the estimate; set by the user). */
    usdRate: z.number().positive().max(1_000_000),
  })
  .partial();
export type UserAiSettings = z.infer<typeof userAiSettingsSchema>;

export const providerSupportsBaseUrl = (p: LlmProvider) => p === 'openai_compatible';
