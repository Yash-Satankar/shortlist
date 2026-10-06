import { DEFAULT_MODELS, estimateCostUsd, LLM_PRICES_USD, LLM_TASK_FEATURE, LLM_TASKS, TASK_PROVIDER_PREFERENCE, type LlmProvider, type LlmTask, type ModelChoice, type UserAiSettings } from '@jt/shared';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { env } from '../config/env';
import { assertFeature } from '../config/features';
import type { DbOrTx } from '../db/client';
import { llmCache, llmUsage, users } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { availableKeys, type AvailableKey } from './keys';
import { LlmError, providerFactory } from './providers';

export interface ResolvedAiSettings {
  models: Partial<Record<LlmTask, ModelChoice>>;
  monthlyCap: number;
  currency: string;
  usdRate: number;
  timezone: string;
}

export async function aiSettings(db: DbOrTx, userId: string): Promise<ResolvedAiSettings> {
  const e = env();
  const [row] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId));
  const ai: UserAiSettings = row?.settings?.ai ?? {};
  return {
    models: ai.models ?? {},
    monthlyCap: ai.monthlyCap ?? e.LLM_MONTHLY_CAP_DEFAULT,
    currency: ai.currency ?? e.DEFAULT_CURRENCY,
    usdRate: ai.usdRate ?? e.DEFAULT_USD_RATE,
    timezone: row?.settings?.timezone ?? e.DEFAULT_TIMEZONE,
  };
}

/** Default model for a provider's task: LLM_DEFAULT_MODELS_JSON over the built-in defaults. */
export function defaultModels(): Record<Exclude<LlmProvider, 'openai_compatible'>, Record<LlmTask, string>> {
  const over = env().LLM_DEFAULT_MODELS_JSON;
  return Object.fromEntries(
    Object.entries(DEFAULT_MODELS).map(([p, tasks]) => [p, { ...tasks, ...over[p as keyof typeof over] }]),
  ) as ReturnType<typeof defaultModels>;
}

/** Provider order for a task: LLM_TASK_PROVIDERS_JSON first, then the built-in order for the rest. */
export function taskProviderOrder(task: LlmTask): LlmProvider[] {
  const first = env().LLM_TASK_PROVIDERS_JSON[task] ?? [];
  return [...new Set([...first, ...TASK_PROVIDER_PREFERENCE[task]])];
}

/**
 * Which provider + model runs a task: the user's choice when they have a key for it, otherwise
 * the task's preferred provider among their keys with its default model. null = no usable key.
 */
export function resolveModel(task: LlmTask, keys: Map<LlmProvider, AvailableKey>, models: ResolvedAiSettings['models']): { key: AvailableKey; model: string } | null {
  const chosen = models[task];
  if (chosen && keys.has(chosen.provider)) return { key: keys.get(chosen.provider)!, model: chosen.model };
  const defaults = defaultModels();
  for (const p of taskProviderOrder(task)) {
    const key = keys.get(p);
    if (key && p !== 'openai_compatible') return { key, model: defaults[p][task] };
  }
  return null; // only a custom endpoint, and no model picked for this task yet
}

const prices = () => ({ ...LLM_PRICES_USD, ...env().LLM_PRICES_JSON });

/** Start of the current month in the user's timezone, as an instant. */
const monthStart = (tz: string) => sql`date_trunc('month', now() at time zone ${tz}) at time zone ${tz}`;

/** This month's estimated spend, in USD. */
export async function monthSpendUsd(db: DbOrTx, userId: string, tz: string): Promise<number> {
  const [r] = await db
    .select({ usd: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)::float` })
    .from(llmUsage)
    .where(and(eq(llmUsage.userId, userId), gte(llmUsage.createdAt, monthStart(tz))));
  return r?.usd ?? 0;
}

// Per-user sliding window (in memory; one app instance).
const recent = new Map<string, number[]>();
function rateLimit(userId: string) {
  const now = Date.now();
  const calls = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (calls.length >= env().LLM_RATE_LIMIT_PER_MIN) throw new LlmError('rate_limited', 'Too many AI requests in a minute. Try again shortly.');
  calls.push(now);
  recent.set(userId, calls);
}
export const resetLlmRateLimits = () => recent.clear();

/** The model's text → the JSON object it was asked for (tolerates code fences and stray prose). */
export function parseJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new LlmError('bad_output', 'The model didn’t return the expected data.');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new LlmError('bad_output', 'The model didn’t return the expected data.');
  }
}

export interface RunInput<S extends z.ZodType> {
  userId: string;
  task: LlmTask;
  /** Bump when the prompt or schema changes, so old cached results aren't reused. */
  promptVersion: number;
  system: string;
  input: string;
  schema: S;
  maxTokens: number;
  /**
   * false: never read or write the cache (e.g. the input holds decrypted emails, which must not
   * be stored in any form). 'refresh': skip the read but store the new result (Regenerate).
   */
  cache?: boolean | 'refresh';
}

export interface RunResult<T> {
  data: T;
  cached: boolean;
  provider: LlmProvider;
  model: string;
  /** This call's tokens and estimated cost (USD); absent on a cache hit. */
  usage?: { inputTokens: number; outputTokens: number; model: string; costUsd: number | null };
}

/**
 * Every LLM call goes through here: feature check → input limit → per-user cache → monthly cap
 * → rate limit → provider → JSON + schema validation → usage log (+ cache). Keys and prompts
 * are never logged.
 */
export async function runLlm<S extends z.ZodType>(db: DbOrTx, args: RunInput<S>): Promise<RunResult<z.infer<S>>> {
  const e = env();
  await assertFeature(db, args.userId, 'ai');
  if (LLM_TASK_FEATURE[args.task] !== 'ai') await assertFeature(db, args.userId, LLM_TASK_FEATURE[args.task]);
  if (args.input.length > e.LLM_MAX_INPUT_CHARS) throw new LlmError('input_too_long', `That’s too much text for one request (limit ${e.LLM_MAX_INPUT_CHARS.toLocaleString('en')} characters).`);

  const settings = await aiSettings(db, args.userId);
  const resolved = resolveModel(args.task, await availableKeys(db, args.userId), settings.models);
  if (!resolved) throw new LlmError('no_key', 'Add an API key in Settings to enable this.');
  const { key, model } = resolved;

  const contentHash = sha256(JSON.stringify([args.promptVersion, args.task, key.provider, model, args.system, args.input]));
  const log = (row: Partial<typeof llmUsage.$inferInsert> & { ok: boolean }) =>
    db.insert(llmUsage).values({ userId: args.userId, task: args.task, provider: key.provider, model, keySource: key.source, ...row });

  const useCache = args.cache ?? true;
  const [hit] = useCache === true
    ? await db
        .select({ result: llmCache.resultEnc })
        .from(llmCache)
        .where(and(eq(llmCache.userId, args.userId), eq(llmCache.contentHash, contentHash), gt(llmCache.expiresAt, new Date())))
    : [];
  if (hit) {
    const parsed = args.schema.safeParse(JSON.parse(hit.result));
    if (parsed.success) {
      await log({ ok: true, cached: true, costUsd: 0 });
      return { data: parsed.data, cached: true, provider: key.provider, model };
    }
  }

  const spentUsd = await monthSpendUsd(db, args.userId, settings.timezone);
  if (spentUsd * settings.usdRate >= settings.monthlyCap) {
    throw new LlmError('cap_reached', `This month’s AI limit (${settings.currency} ${settings.monthlyCap}) is used up. Raise it in Settings, or it resets next month.`);
  }
  rateLimit(args.userId);

  let data: z.infer<S>;
  let usage = { inputTokens: 0, outputTokens: 0, model };
  try {
    const res = await providerFactory.create(key).complete(model, { task: args.task, system: args.system, user: args.input, maxTokens: args.maxTokens, json: true });
    usage = { inputTokens: res.inputTokens, outputTokens: res.outputTokens, model: res.model };
    const parsed = args.schema.safeParse(parseJsonObject(res.text));
    if (!parsed.success) throw new LlmError('bad_output', 'The model didn’t return the expected data.');
    data = parsed.data;
  } catch (err) {
    const code = err instanceof LlmError ? err.code : 'provider_error';
    await log({ ok: false, errorCode: code, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens, prices()) });
    throw err instanceof LlmError ? err : new LlmError('provider_error', 'The AI request failed.');
  }

  await log({ ok: true, model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens, prices()) });
  if (useCache === false) return { data, cached: false, provider: key.provider, model, usage: { ...usage, costUsd: estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens, prices()) } };
  const expiresAt = new Date(Date.now() + e.LLM_CACHE_TTL_DAYS * 86_400_000);
  await db
    .insert(llmCache)
    .values({ userId: args.userId, task: args.task, contentHash, provider: key.provider, model, resultEnc: JSON.stringify(data), expiresAt })
    .onConflictDoUpdate({ target: [llmCache.userId, llmCache.contentHash], set: { resultEnc: JSON.stringify(data), expiresAt } });
  return { data, cached: false, provider: key.provider, model, usage: { ...usage, costUsd: estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens, prices()) } };
}

/** Rough tokens for a text (≈4 characters per token for English). For estimates only. */
export const roughTokens = (chars: number) => Math.ceil(chars / 4);

export interface CostEstimate {
  provider: LlmProvider;
  model: string;
  /** In the user's currency; null when the model's price isn't known. */
  cost: number | null;
  currency: string;
}

/**
 * What a run would cost at most, before it runs ("Generate — about ₹0.40"): the input's rough
 * token count plus the full output budget, at the resolved model's price. null = no usable key.
 */
export async function estimateLlmCost(db: DbOrTx, userId: string, task: LlmTask, inputChars: number, maxTokens: number): Promise<CostEstimate | null> {
  const settings = await aiSettings(db, userId);
  const resolved = resolveModel(task, await availableKeys(db, userId), settings.models);
  if (!resolved) return null;
  const usd = estimateCostUsd(resolved.model, roughTokens(inputChars), maxTokens, prices());
  return { provider: resolved.key.provider, model: resolved.model, cost: usd == null ? null : Math.round(usd * settings.usdRate * 100) / 100, currency: settings.currency };
}

export interface UsageSummary {
  month: string;
  calls: number;
  cachedHits: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /** Estimated, in the user's currency. */
  cost: number;
  /** Calls whose model has no known price (not included in `cost`). */
  unpricedCalls: number;
  cap: number;
  currency: string;
  byTask: Record<LlmTask, { calls: number; cost: number }>;
}

const summarize = (rows: { task: LlmTask; cached: boolean; ok: boolean; inputTokens: number; outputTokens: number; costUsd: number | null }[], rate: number) => {
  const byTask = Object.fromEntries(LLM_TASKS.map((t) => [t, { calls: 0, cost: 0 }])) as UsageSummary['byTask'];
  let calls = 0, cachedHits = 0, failed = 0, inputTokens = 0, outputTokens = 0, cost = 0, unpricedCalls = 0;
  for (const r of rows) {
    if (r.cached) cachedHits++;
    else calls++;
    if (!r.ok) failed++;
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    if (r.costUsd == null && !r.cached && r.inputTokens + r.outputTokens > 0) unpricedCalls++;
    const c = (r.costUsd ?? 0) * rate;
    cost += c;
    if (!r.cached) byTask[r.task].calls++;
    byTask[r.task].cost += c;
  }
  return { calls, cachedHits, failed, inputTokens, outputTokens, cost: Math.round(cost * 100) / 100, unpricedCalls, byTask };
};

/** This month's usage for one user, in their currency, against their cap. */
export async function usageSummary(db: DbOrTx, userId: string): Promise<UsageSummary> {
  const s = await aiSettings(db, userId);
  const rows = await db
    .select({ task: llmUsage.task, cached: llmUsage.cached, ok: llmUsage.ok, inputTokens: llmUsage.inputTokens, outputTokens: llmUsage.outputTokens, costUsd: llmUsage.costUsd })
    .from(llmUsage)
    .where(and(eq(llmUsage.userId, userId), gte(llmUsage.createdAt, monthStart(s.timezone))));
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone, year: 'numeric', month: '2-digit' }).format(new Date());
  return { month, ...summarize(rows, s.usdRate), cap: s.monthlyCap, currency: s.currency };
}

/** Admins: this month across the instance (totals only, no per-user detail), in the admin's currency. */
export async function instanceUsageSummary(db: DbOrTx, adminId: string) {
  const s = await aiSettings(db, adminId);
  const rows = await db
    .select({ task: llmUsage.task, cached: llmUsage.cached, ok: llmUsage.ok, inputTokens: llmUsage.inputTokens, outputTokens: llmUsage.outputTokens, costUsd: llmUsage.costUsd, keySource: llmUsage.keySource })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, monthStart(s.timezone)));
  const [active] = await db
    .select({ users: sql<number>`count(distinct ${llmUsage.userId})::int` })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, monthStart(s.timezone)));
  return { ...summarize(rows, s.usdRate), instanceKeyCalls: rows.filter((r) => r.keySource === 'instance' && !r.cached).length, activeUsers: active?.users ?? 0, currency: s.currency };
}
