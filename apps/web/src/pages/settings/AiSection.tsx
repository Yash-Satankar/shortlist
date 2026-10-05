import { LLM_PROVIDER_LABELS, LLM_PROVIDERS, LLM_TASK_LABELS, LLM_TASKS, type LlmProvider, type LlmTask } from '@jt/shared';
import { useState, type FormEvent } from 'react';
import { useAi, useAiUsage, useDeleteAiKey, useFeatures, useSaveAiKey, useUpdateAiSettings, type AiOverview } from '../../api/hooks';
import { Icon } from '../../components/Icon';
import { Button, ErrorNote, Field, SectionLabel, Segmented, Sheet, Spinner, useToast } from '../../components/ui';
import { formatDate } from '../../lib/format';

const SHORT: Record<LlmProvider, string> = { anthropic: 'Anthropic', groq: 'Groq', together: 'Together', openai_compatible: 'Custom' };
const KEY_HINT: Record<LlmProvider, string> = {
  anthropic: 'console.anthropic.com → API keys',
  groq: 'console.groq.com → API keys',
  together: 'api.together.ai → Settings → API keys',
  openai_compatible: 'Any endpoint that speaks the OpenAI chat API',
};

const money = (n: number, currency: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/**
 * Settings → AI: bring your own key. Keys are checked with a free call, stored encrypted and
 * shown as the last 4 characters only. Hidden when the server doesn't offer AI or you
 * switched AI off in Features.
 */
export function AiSection() {
  const features = useFeatures();
  const ai = features.data?.features.ai;
  const visible = !!ai && ai.reason !== 'instance_off' && ai.reason !== 'user_off';
  const overview = useAi(visible);
  const usage = useAiUsage(visible);
  const del = useDeleteAiKey();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editingTask, setEditingTask] = useState<LlmTask | null>(null);
  const [editingCap, setEditingCap] = useState(false);

  if (!visible) return null;
  const data = overview.data;
  const mine = usage.data?.mine;

  return (
    <>
      <SectionLabel className="pt-[22px]" action="Your own API keys">
        AI
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        {overview.isPending ? (
          <Spinner />
        ) : data ? (
          <>
            <div className="group">
              {data.keys.length === 0 && data.instanceProviders.length === 0 && (
                <div className="gi text-sm text-ink-3">No API key yet. AI features stay off until you add one; everything else works.</div>
              )}
              {data.keys.map((k) => (
                <div key={k.provider} className="gi pr-1">
                  <Icon name="key" className="text-ink-2" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm leading-5 font-semibold">{LLM_PROVIDER_LABELS[k.provider]}</div>
                    <div className="ev-time truncate leading-4">
                      •••• {k.last4}
                      {k.baseUrl ? ` · ${new URL(k.baseUrl).host}` : ''} · checked {formatDate(k.validatedAt ?? k.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="quiet"
                    className="px-3 text-sm"
                    disabled={del.isPending}
                    onClick={() =>
                      window.confirm(`Remove your ${LLM_PROVIDER_LABELS[k.provider]} key? AI tasks using it stop until you add another.`) &&
                      del.mutate(k.provider, {
                        onSuccess: () => toast({ message: `${LLM_PROVIDER_LABELS[k.provider]} key removed`, tone: 'info' }),
                        onError: (err) => toast({ message: err.message, tone: 'error' }),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {data.instanceProviders
                .filter((p) => !data.keys.some((k) => k.provider === p))
                .map((p) => (
                  <div key={p} className="gi">
                    <Icon name="lock" className="text-ink-2" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm leading-5 font-semibold">{LLM_PROVIDER_LABELS[p]}</div>
                      <div className="ev-time truncate leading-4">server key · admins only</div>
                    </div>
                  </div>
                ))}
            </div>
            <Button className="w-full" onClick={() => setAdding(true)}>
              <Icon name="plus" />
              Add an API key
            </Button>

            <div className="hint px-0.5 pt-1">Model for each task</div>
            <div className="group">
              {LLM_TASKS.map((t) => {
                const run = data.tasks[t];
                return (
                  <button key={t} type="button" className="gi w-full pr-2 text-left" onClick={() => setEditingTask(t)} disabled={!run && data.keys.length === 0}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm leading-5 font-semibold">{LLM_TASK_LABELS[t]}</div>
                      <div className="ev-time truncate leading-4">{run ? `${SHORT[run.provider]} · ${run.model}` : 'needs a key'}</div>
                    </div>
                    {(run || data.keys.length > 0) && <Icon name="edit" size="sm" className="text-ink-3" />}
                  </button>
                );
              })}
            </div>

            <div className="hint px-0.5 pt-1">This month</div>
            <div className="group">
              <button type="button" className="gi w-full pr-2 text-left" onClick={() => setEditingCap(true)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm leading-5 font-semibold">
                    {mine ? `${money(mine.cost, mine.currency)} of ${money(mine.cap, mine.currency)}` : '…'}
                  </div>
                  <div className="ev-time truncate leading-4">
                    {mine
                      ? `${mine.calls} ${mine.calls === 1 ? 'call' : 'calls'} · ${compact(mine.inputTokens + mine.outputTokens)} tokens · ${mine.cachedHits} from cache${mine.unpricedCalls ? ` · ${mine.unpricedCalls} not priced` : ''}`
                      : ''}
                  </div>
                </div>
                <Icon name="edit" size="sm" className="text-ink-3" />
              </button>
              {usage.data?.instance && usage.data.instance.activeUsers > 1 && (
                <div className="gi">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm leading-5 font-semibold">Everyone on this server</div>
                    <div className="ev-time truncate leading-4">
                      {money(usage.data.instance.cost, usage.data.instance.currency)} · {usage.data.instance.calls} calls · {usage.data.instance.activeUsers} people
                      {usage.data.instance.instanceKeyCalls ? ` · ${usage.data.instance.instanceKeyCalls} on server keys` : ''}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <p className="hint m-0 px-0.5">Estimated from each provider’s list prices. Repeated requests are answered from a cache at no cost.</p>
          </>
        ) : (
          <ErrorNote error={overview.error} />
        )}
      </div>

      {data && <AddKeySheet open={adding} onClose={() => setAdding(false)} existing={data} />}
      {data && editingTask && <ModelSheet task={editingTask} data={data} onClose={() => setEditingTask(null)} />}
      {data && editingCap && <CapSheet data={data} onClose={() => setEditingCap(false)} />}
    </>
  );
}

function AddKeySheet({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: AiOverview }) {
  const save = useSaveAiKey();
  const toast = useToast();
  const [provider, setProvider] = useState<LlmProvider>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const replacing = existing.keys.some((k) => k.provider === provider);

  const close = () => {
    setApiKey(''); // never kept around
    save.reset();
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { provider, apiKey: apiKey.trim(), baseUrl: baseUrl.trim() || undefined },
      {
        onSuccess: () => {
          toast({ message: `${LLM_PROVIDER_LABELS[provider]} key saved`, tone: 'info' });
          close();
        },
      },
    );
  };

  return (
    <Sheet open={open} onClose={close} title="Add an API key">
      <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
        <Segmented<LlmProvider> label="Provider" value={provider} onChange={(p) => (setProvider(p), save.reset())} options={LLM_PROVIDERS.map((p) => ({ value: p, label: SHORT[p] }))} />
        {provider === 'openai_compatible' && (
          <Field label="Base URL" hint="Ends in /v1. Must be a public https address.">
            <input className="inp" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" inputMode="url" autoComplete="off" spellCheck={false} required />
          </Field>
        )}
        <Field label="API key" hint={KEY_HINT[provider]} error={save.error?.message}>
          <input
            className={`inp num ${save.error ? 'err' : ''}`}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={save.error ? true : undefined}
            required
          />
        </Field>
        <p className="hint m-0">
          Checked with a free call to {LLM_PROVIDER_LABELS[provider]}, then stored encrypted. Only the last 4 characters are ever shown.
          {replacing ? ' This replaces your current key.' : ''}
        </p>
        <Button type="submit" variant="primary" size="block" disabled={!apiKey.trim() || save.isPending} busy={save.isPending}>
          {save.isPending ? 'Checking…' : 'Save key'}
        </Button>
      </form>
    </Sheet>
  );
}

function ModelSheet({ task, data, onClose }: { task: LlmTask; data: AiOverview; onClose: () => void }) {
  const update = useUpdateAiSettings();
  const usable = [...new Set([...data.keys.map((k) => k.provider), ...data.instanceProviders])];
  const current = data.tasks[task];
  const [provider, setProvider] = useState<LlmProvider>(current?.provider ?? usable[0] ?? 'anthropic');
  const defaultFor = (p: LlmProvider) => (p === 'openai_compatible' ? '' : data.defaults[p][task]);
  const [model, setModel] = useState(current?.provider === provider ? current.model : defaultFor(provider));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ models: { [task]: { provider, model: model.trim() } } }, { onSuccess: onClose });
  };

  return (
    <Sheet open onClose={onClose} title={LLM_TASK_LABELS[task]}>
      <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
        <Segmented<LlmProvider>
          label="Provider"
          value={provider}
          onChange={(p) => {
            setProvider(p);
            setModel(defaultFor(p));
          }}
          options={usable.map((p) => ({ value: p, label: SHORT[p] }))}
        />
        <Field label="Model" hint={provider === 'openai_compatible' ? 'The model name your endpoint expects.' : `Default: ${defaultFor(provider)}`} error={update.error?.message}>
          <input className="inp num" value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" spellCheck={false} required />
        </Field>
        <Button type="submit" variant="primary" size="block" disabled={!model.trim() || update.isPending} busy={update.isPending}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

function CapSheet({ data, onClose }: { data: AiOverview; onClose: () => void }) {
  const update = useUpdateAiSettings();
  const [cap, setCap] = useState(String(data.settings.monthlyCap));
  const [currency, setCurrency] = useState(data.settings.currency);
  const [rate, setRate] = useState(String(data.settings.usdRate));
  const valid = Number(cap) >= 0 && /^[A-Z]{3}$/.test(currency) && Number(rate) > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ monthlyCap: Number(cap), currency, usdRate: Number(rate) }, { onSuccess: onClose });
  };

  return (
    <Sheet open onClose={onClose} title="Monthly AI limit">
      <form onSubmit={submit} className="flex flex-col gap-3 px-4 pb-4">
        <Field label="Limit per month" hint="AI features pause with a clear message when it’s reached, and resume next month.">
          <input className="inp num" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} required />
        </Field>
        <Field label="Currency" hint="3-letter code, e.g. INR, USD, EUR.">
          <input className="inp num" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} required />
        </Field>
        <Field label={`${currency || '…'} per US dollar`} hint="Providers price in dollars; this converts the estimate.">
          <input className="inp num" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
        </Field>
        <ErrorNote error={update.error} />
        <Button type="submit" variant="primary" size="block" disabled={!valid || update.isPending} busy={update.isPending}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}
