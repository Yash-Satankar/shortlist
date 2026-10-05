import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { LLM_BASE_URLS, type LlmProvider, type LlmTask } from '@jt/shared';
import { env } from '../config/env';

export type LlmErrorCode =
  | 'no_key' // no key the user may use for this task
  | 'invalid_key' // provider rejected the key
  | 'rate_limited'
  | 'timeout'
  | 'refused' // the model declined
  | 'bad_output' // truncated or not the JSON we asked for
  | 'provider_error'
  | 'cap_reached' // monthly cap
  | 'input_too_long'
  | 'unsafe_base_url';

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CompletionRequest {
  task: LlmTask;
  system: string;
  user: string;
  maxTokens: number;
  /** Ask for a JSON object (prompt + provider JSON mode where supported). */
  json: boolean;
}

export interface CompletionResult {
  text: string;
  /** The model that actually answered (a server-side fallback may differ from the one asked). */
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderClient {
  complete(model: string, req: CompletionRequest): Promise<CompletionResult>;
  /** Cheapest possible authenticated call (lists models; no tokens). Throws LlmError('invalid_key') on rejection. */
  validate(): Promise<void>;
}

export interface ResolvedKey {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string | null;
}

// ---------------------------------------------------------------- Anthropic (official SDK)

/** Models that take `effort` and the server-side refusal fallback ("default" routing). */
const EFFORT_MODELS = /^claude-(opus-5|opus-4-[678]|sonnet-5|fable-5)/;
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5-1)/;

function anthropicClient(apiKey: string): ProviderClient {
  const client = new Anthropic({ apiKey, timeout: env().LLM_TIMEOUT_MS, maxRetries: 1 });
  const mapError = (err: unknown): never => {
    if (err instanceof LlmError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw new LlmError('invalid_key', 'The Anthropic API key was rejected.');
    if (err instanceof Anthropic.RateLimitError) throw new LlmError('rate_limited', 'Anthropic is rate-limiting this key. Try again shortly.');
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new LlmError('timeout', 'Anthropic took too long to answer.');
    if (err instanceof Anthropic.APIError) throw new LlmError('provider_error', `Anthropic error ${err.status ?? ''}`.trim());
    throw new LlmError('provider_error', 'Couldn’t reach Anthropic.');
  };
  return {
    async complete(model, req) {
      try {
        const res = await client.beta.messages.create({
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          // Short structured tasks run at low effort; writing tasks at medium.
          ...(EFFORT_MODELS.test(model) ? { output_config: { effort: req.task === 'prep' ? 'medium' : 'low' } } : {}),
          // A safety decline is retried server-side on a suitable model instead of failing.
          ...(FALLBACK_MODELS.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        });
        if (res.stop_reason === 'refusal') throw new LlmError('refused', 'The model declined this request.');
        if (res.stop_reason === 'max_tokens') throw new LlmError('bad_output', 'The answer was cut off.');
        const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        return { text, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
      } catch (err) {
        return mapError(err);
      }
    },
    async validate() {
      try {
        await client.models.list({ limit: 1 });
      } catch (err) {
        mapError(err);
      }
    },
  };
}

// ---------------------------------------------------------------- OpenAI-compatible (Groq, Together, custom)

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^0\./];
const isPrivateAddress = (ip: string) =>
  isIP(ip) === 6 ? /^(::1|::|fc|fd|fe80|::ffff:(10|127|169\.254|172\.(1[6-9]|2\d|3[01])|192\.168)\.)/i.test(ip) : PRIVATE_V4.some((r) => r.test(ip));

/**
 * A user-entered base URL is fetched by this server, so it must not point into the private
 * network (other services, the database, cloud metadata). https + public addresses only,
 * unless the self-hoster sets LLM_ALLOW_PRIVATE_BASE_URLS=true (e.g. a local model server).
 */
export async function assertSafeBaseUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LlmError('unsafe_base_url', 'That isn’t a valid URL.');
  }
  const allowPrivate = env().LLM_ALLOW_PRIVATE_BASE_URLS;
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw new LlmError('unsafe_base_url', 'The base URL must use https.');
  if (url.username || url.password) throw new LlmError('unsafe_base_url', 'Put the key in the key field, not in the URL.');
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localdomain)$/i.test(host)) throw new LlmError('unsafe_base_url', 'Private addresses aren’t allowed.');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new LlmError('unsafe_base_url', 'That host can’t be resolved.');
  if (addrs.some(isPrivateAddress)) throw new LlmError('unsafe_base_url', 'Private addresses aren’t allowed.');
  return url;
}

function openAiCompatibleClient(provider: LlmProvider, apiKey: string, baseUrl: string): ProviderClient {
  const base = baseUrl.replace(/\/+$/, '');
  const label = provider === 'openai_compatible' ? new URL(base).host : provider === 'groq' ? 'Groq' : 'Together AI';
  const call = async (path: string, init: RequestInit) => {
    if (provider === 'openai_compatible') await assertSafeBaseUrl(base); // re-checked per call (DNS can change)
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        redirect: 'error',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(env().LLM_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') throw new LlmError('timeout', `${label} took too long to answer.`);
      throw new LlmError('provider_error', `Couldn’t reach ${label}.`);
    }
    if (res.status === 401 || res.status === 403) throw new LlmError('invalid_key', `The ${label} API key was rejected.`);
    if (res.status === 429) throw new LlmError('rate_limited', `${label} is rate-limiting this key. Try again shortly.`);
    if (!res.ok) {
      // Include the provider's own short reason (e.g. "model not found"), never the request.
      const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } | string; message?: unknown } | null;
      const raw = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? body?.message);
      const reason = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').replace(/(sk|gsk|tgp)[-_][A-Za-z0-9_-]{6,}/g, '[key]').slice(0, 160) : '';
      throw new LlmError('provider_error', `${label} error ${res.status}${reason ? `: ${reason}` : ''}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  };
  return {
    async complete(model, req) {
      const body = await call('/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens,
          temperature: 0.2,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          // JSON mode on the known providers; custom endpoints may not support it (the prompt asks anyway).
          ...(req.json && provider !== 'openai_compatible' ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      const choice = (body.choices as { message?: { content?: string }; finish_reason?: string }[] | undefined)?.[0];
      if (choice?.finish_reason === 'length') throw new LlmError('bad_output', 'The answer was cut off.');
      const usage = (body.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
      return { text: choice?.message?.content ?? '', model: typeof body.model === 'string' ? body.model : model, inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 };
    },
    async validate() {
      await call('/models', { method: 'GET' });
    },
  };
}

export function providerClient(key: ResolvedKey): ProviderClient {
  if (key.provider === 'anthropic') return anthropicClient(key.apiKey);
  const base = key.provider === 'openai_compatible' ? key.baseUrl : LLM_BASE_URLS[key.provider];
  if (!base) throw new LlmError('no_key', 'This provider needs a base URL.');
  return openAiCompatibleClient(key.provider, key.apiKey, base);
}

/** Test hook: swap the provider factory (unit tests never call real APIs). */
export const providerFactory = { create: providerClient };
