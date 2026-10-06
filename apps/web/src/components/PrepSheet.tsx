import { PREP_OUTDATED_LABELS, type PrepPack } from '@jt/shared';
import type { ReactNode } from 'react';
import { useGeneratePrep, usePrep, type CostEstimate } from '../api/hooks';
import { formatDate } from '../lib/format';
import { Icon } from './Icon';
import { Button, ErrorNote, Sheet, Spinner } from './ui';

/** "about ₹0.42" (or "cost unknown" for a model without a known price). */
export function costLabel(e: CostEstimate | null): string {
  if (!e) return '';
  if (e.cost == null) return 'cost unknown';
  const value = e.cost < 0.01 ? '<0.01' : e.cost.toFixed(2);
  return `about ${e.currency === 'INR' ? '₹' : `${e.currency} `}${value}`;
}

const modelName = (m: string) => m.split('/').pop() ?? m;

/**
 * Interview prep pack for one application: stored (encrypted) once generated, marked outdated
 * when the JD, resume or answer library changed since. Generating shows the cost first.
 */
export function PrepSheet({ applicationId, title, open, onClose }: { applicationId: string; title: string; open: boolean; onClose: () => void }) {
  const prep = usePrep(applicationId, open);
  const generate = useGeneratePrep(applicationId);
  const s = prep.data;
  const cost = costLabel(s?.estimate ?? null);

  const footer = s && (
    <div className="flex flex-col gap-1.5 pb-3">
      <Button variant={s.pack ? 'secondary' : 'ink'} size="block" busy={generate.isPending} disabled={generate.isPending || !s.estimate} onClick={() => generate.mutate()}>
        {s.pack ? <Icon name="refresh" /> : <Icon name="sparkle" />}
        {generate.isPending ? 'Writing your prep pack…' : `${s.pack ? 'Regenerate' : 'Generate prep pack'}${cost ? ` · ${cost}` : ''}`}
      </Button>
      {s.estimate && (
        <p className="hint m-0 text-center">
          {modelName(s.estimate.model)} · uses your API key{s.pack ? ' · replaces this pack' : ''}
        </p>
      )}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title={`Prep · ${title}`} footer={footer}>
      <div className="px-4 pt-1 pb-4">
        {prep.isPending ? (
          <Spinner />
        ) : prep.error ? (
          <ErrorNote error={prep.error} onRetry={() => void prep.refetch()} />
        ) : s ? (
          <>
            {generate.error && <ErrorNote error={generate.error} />}
            {s.pack && s.outdated.length > 0 && (
              <div className="card mb-3 flex gap-2.5 py-3">
                <Icon name="alert" className="mt-px text-accent-text" />
                <p className="m-0 text-sm leading-5">
                  <b className="font-semibold">Outdated.</b> Your {list(s.outdated.map((r) => PREP_OUTDATED_LABELS[r]))} changed since this was written.
                </p>
              </div>
            )}
            {!s.pack && (
              <>
                <p className="m-0 text-[15px] leading-[22px]">Likely interview questions, where you match the job and where you don’t, talking points, and questions to ask them, written for this role.</p>
                {s.missing.length > 0 && (
                  <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
                    {s.missing.includes('jd') && <Missing>No job description saved. Add it on the JD tab for a sharper pack.</Missing>}
                    {s.missing.includes('resume') && <Missing>No resume text. Add it in Settings → Profile so strengths come from your experience.</Missing>}
                  </ul>
                )}
              </>
            )}
            {s.pack && <Pack pack={s.pack.content} />}
            {s.pack && (
              <p className="ev-time m-0 mt-4">
                Written {formatDate(s.pack.generatedAt)} · {modelName(s.pack.model)}
              </p>
            )}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? ''));

function Missing({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2 text-sm leading-5 text-ink-2">
      <Icon name="info" size="sm" className="mt-0.5 text-ink-3" />
      {children}
    </li>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="sect m-0 px-0 pb-1.5">{title}</h3>
      {children}
    </section>
  );
}

function Pack({ pack }: { pack: PrepPack }) {
  return (
    <>
      <Block title="The role">
        <p className="m-0 text-[15px] leading-[22px]">{pack.summary}</p>
      </Block>
      <Block title="Likely questions">
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {pack.likelyQuestions.map((q, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="ref-chip mt-0.5">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-[15px] leading-[21px] font-semibold">{q.question}</div>
                <div className="hint mt-0.5">{q.why}</div>
                {q.answerHints.length > 0 && (
                  <ul className="m-0 mt-1 list-disc pl-4 text-sm leading-5 text-ink-2">
                    {q.answerHints.map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Block>
      {pack.strengths.length > 0 && (
        <Block title="Where you match">
          <Points items={pack.strengths.map((x) => [x.point, x.evidence])} icon="check" />
        </Block>
      )}
      {pack.gaps.length > 0 && (
        <Block title="Gaps to address">
          <Points items={pack.gaps.map((x) => [x.gap, x.howToAddress])} icon="alert" />
        </Block>
      )}
      {pack.talkingPoints.length > 0 && (
        <Block title="Talking points">
          <Points items={pack.talkingPoints.map((x) => [x, null])} icon="chat" />
        </Block>
      )}
      {pack.questionsToAsk.length > 0 && (
        <Block title="Questions to ask them">
          <Points items={pack.questionsToAsk.map((x) => [x, null])} icon="info" />
        </Block>
      )}
    </>
  );
}

function Points({ items, icon }: { items: [string, string | null][]; icon: 'check' | 'alert' | 'chat' | 'info' }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map(([main, sub], i) => (
        <li key={i} className="flex gap-2.5">
          <Icon name={icon} size="sm" className="mt-0.5 text-ink-3" />
          <div className="min-w-0 text-sm leading-5">
            {main}
            {sub && <div className="hint mt-0.5">{sub}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
