import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { Button, ErrorNote, SectionLabel } from '../../components/ui';
import { formatEventTime } from '../../lib/format';

interface AppError {
  id: string;
  kind: 'request' | 'job';
  where: string;
  status: number | null;
  errorName: string | null;
  message: string;
  location: string | null;
  requestId: string | null;
  createdAt: string;
}

const SHOWN = 5;

/**
 * Settings → Recent errors (admins only): unexpected server errors and failed background jobs,
 * sanitized (no emails, keys or request bodies), kept ERROR_LOG_RETENTION_DAYS.
 */
export function ErrorsSection() {
  const errors = useQuery({ queryKey: ['admin-errors'], queryFn: () => api<{ items: AppError[]; retentionDays: number }>('/admin/errors') });
  const [all, setAll] = useState(false);
  const items = errors.data?.items ?? [];
  const visible = all ? items : items.slice(0, SHOWN);

  return (
    <>
      <SectionLabel className="pt-[22px]" action={errors.data ? `Admin · last ${errors.data.retentionDays} days` : 'Admin'}>
        Recent errors
      </SectionLabel>
      <div className="flex flex-col gap-2.5 px-4">
        {errors.error && <ErrorNote error={errors.error} onRetry={() => void errors.refetch()} />}
        {errors.data && !items.length && <p className="hint m-0 px-0.5">No server errors. Failed requests and background jobs show up here, without personal data.</p>}
        {visible.length > 0 && (
          <div className="group">
            {visible.map((e) => (
              <div key={e.id} className="gi block py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="ev-time truncate">{e.kind === 'job' ? `job · ${e.where}` : e.where}</span>
                  <span className="ev-time shrink-0">{formatEventTime(e.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-sm leading-5 break-words">{e.message}</div>
                {(e.location || e.requestId) && <div className="hint mt-0.5 truncate">{[e.location, e.requestId && `request ${e.requestId}`].filter(Boolean).join(' · ')}</div>}
              </div>
            ))}
          </div>
        )}
        {items.length > SHOWN && (
          <Button variant="quiet" className="-mt-1 self-start px-2 text-sm" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${items.length}`}
          </Button>
        )}
      </div>
    </>
  );
}
