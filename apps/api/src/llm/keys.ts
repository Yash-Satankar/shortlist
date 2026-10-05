import { LLM_PROVIDERS, type LlmProvider } from '@jt/shared';
import { and, eq } from 'drizzle-orm';
import { env } from '../config/env';
import type { DbOrTx } from '../db/client';
import { llmKeys, users } from '../db/schema';
import { assertSafeBaseUrl, LlmError, providerFactory, type ResolvedKey } from './providers';

export interface KeyRow {
  provider: LlmProvider;
  baseUrl: string | null;
  last4: string;
  validatedAt: Date | null;
  createdAt: Date;
}

/** The user's saved keys, without the keys themselves (they never leave the server). */
export async function listKeys(db: DbOrTx, userId: string): Promise<KeyRow[]> {
  const rows = await db
    .select({ provider: llmKeys.provider, baseUrl: llmKeys.baseUrl, last4: llmKeys.keyLast4, validatedAt: llmKeys.validatedAt, createdAt: llmKeys.createdAt })
    .from(llmKeys)
    .where(eq(llmKeys.userId, userId));
  return rows.sort((a, b) => LLM_PROVIDERS.indexOf(a.provider) - LLM_PROVIDERS.indexOf(b.provider));
}

/** Validates the key with a free authenticated call, then stores it encrypted (one per provider). */
export async function saveKey(db: DbOrTx, userId: string, input: { provider: LlmProvider; apiKey: string; baseUrl?: string | null }): Promise<KeyRow> {
  const apiKey = input.apiKey.trim();
  let baseUrl: string | null = null;
  if (input.provider === 'openai_compatible') {
    if (!input.baseUrl) throw new LlmError('unsafe_base_url', 'Enter the provider’s base URL (ending in /v1).');
    baseUrl = (await assertSafeBaseUrl(input.baseUrl)).href.replace(/\/+$/, '');
  }
  await providerFactory.create({ provider: input.provider, apiKey, baseUrl }).validate();

  const values = { provider: input.provider, baseUrl, keyEnc: apiKey, keyLast4: apiKey.slice(-4), validatedAt: new Date() };
  await db
    .insert(llmKeys)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: [llmKeys.userId, llmKeys.provider], set: values });
  return (await listKeys(db, userId)).find((k) => k.provider === input.provider)!;
}

export async function deleteKey(db: DbOrTx, userId: string, provider: LlmProvider): Promise<boolean> {
  const deleted = await db.delete(llmKeys).where(and(eq(llmKeys.userId, userId), eq(llmKeys.provider, provider))).returning({ id: llmKeys.id });
  return deleted.length > 0;
}

/** Keys set in env by a self-hoster. They serve admin accounts only. */
export function instanceKeys(): Map<LlmProvider, ResolvedKey> {
  const e = env();
  const out = new Map<LlmProvider, ResolvedKey>();
  if (e.ANTHROPIC_API_KEY) out.set('anthropic', { provider: 'anthropic', apiKey: e.ANTHROPIC_API_KEY, baseUrl: null });
  if (e.GROQ_API_KEY) out.set('groq', { provider: 'groq', apiKey: e.GROQ_API_KEY, baseUrl: null });
  if (e.TOGETHER_API_KEY) out.set('together', { provider: 'together', apiKey: e.TOGETHER_API_KEY, baseUrl: null });
  if (e.OPENAI_COMPATIBLE_API_KEY && e.OPENAI_COMPATIBLE_BASE_URL) {
    out.set('openai_compatible', { provider: 'openai_compatible', apiKey: e.OPENAI_COMPATIBLE_API_KEY, baseUrl: e.OPENAI_COMPATIBLE_BASE_URL });
  }
  return out;
}

export interface AvailableKey extends ResolvedKey {
  source: 'user' | 'instance';
}

/** Keys this user may use: their own, plus (admins only) instance keys for providers they have no key for. */
export async function availableKeys(db: DbOrTx, userId: string): Promise<Map<LlmProvider, AvailableKey>> {
  const [own, [user]] = await Promise.all([
    db.select({ provider: llmKeys.provider, apiKey: llmKeys.keyEnc, baseUrl: llmKeys.baseUrl }).from(llmKeys).where(eq(llmKeys.userId, userId)),
    db.select({ role: users.role }).from(users).where(eq(users.id, userId)),
  ]);
  const out = new Map<LlmProvider, AvailableKey>(own.map((k) => [k.provider, { ...k, source: 'user' as const }]));
  if (user?.role === 'admin') {
    for (const [p, k] of instanceKeys()) if (!out.has(p)) out.set(p, { ...k, source: 'instance' });
  }
  return out;
}
