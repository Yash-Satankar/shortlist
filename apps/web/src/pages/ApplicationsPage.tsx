import { APPLICATION_SOURCE_LABELS, WORK_MODE_LABELS } from '@jt/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApplications } from '../api/hooks';
import type { ApplicationListItem } from '../api/types';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/Layout';
import { EmptyState, ErrorNote, inputClass, Spinner, StatusBadge } from '../components/ui';
import { formatDate, relativeDays, STATUS_GROUPS } from '../lib/format';

const DEFAULT_GROUP = 'active';

export function ApplicationsPage() {
  const [params, setParams] = useSearchParams();
  const group = params.get('group') ?? DEFAULT_GROUP;
  const [q, setQ] = useState(params.get('q') ?? '');

  // Debounce typing into the URL (which drives the query).
  useEffect(() => {
    const t = setTimeout(() => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          if (q.trim()) next.set('q', q.trim());
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 250);
    return () => clearTimeout(t);
  }, [q, setParams]);

  const apiParams = useMemo(() => {
    const p = new URLSearchParams({ limit: '500' });
    const statuses = STATUS_GROUPS.find((g) => g.id === group)?.statuses;
    if (statuses) p.set('status', statuses.join(','));
    const query = params.get('q');
    if (query) p.set('q', query);
    return p;
  }, [group, params]);

  const { data, isPending, error, isFetching } = useApplications(apiParams);

  const setGroup = (id: string) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id === DEFAULT_GROUP) next.delete('group');
      else next.set('group', id);
      return next;
    });

  return (
    <>
      <PageHeader title="Applications" actions={data && <span className="text-sm text-slate-500">{data.total}</span>}>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company, role, JD, answers…"
            className={`${inputClass} pl-9`}
            aria-label="Search applications"
          />
        </div>
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {STATUS_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm font-medium ${
                g.id === group
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                  : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <main className={`mx-auto max-w-3xl px-4 py-3 transition-opacity ${isFetching && !isPending ? 'opacity-70' : ''}`}>
        <ErrorNote error={error} />
        {isPending ? (
          <Spinner />
        ) : data && data.items.length === 0 ? (
          <EmptyState title={params.get('q') ? 'No matches' : 'Nothing here yet'}>
            {params.get('q') ? 'Try another search or filter.' : <Link to="/add" className="underline">Add an application</Link>}
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {data?.items.map((item) => (
              <li key={item.id}>
                <ApplicationRow item={item} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

function ApplicationRow({ item }: { item: ApplicationListItem }) {
  const mode = item.workMode !== 'unknown' ? WORK_MODE_LABELS[item.workMode] : null;
  // Avoid "Remote · Remote" when the location itself says Remote.
  const showMode = mode && mode.toLowerCase() !== item.location?.trim().toLowerCase();
  const meta = [item.location, showMode ? mode : null, APPLICATION_SOURCE_LABELS[item.source]].filter(Boolean).join(' · ');
  return (
    <Link
      to={`/applications/${item.id}`}
      className="block rounded-xl border border-slate-200 bg-white px-4 py-3 active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{item.companyName}</p>
          <p className="truncate text-sm text-slate-700 dark:text-slate-300">{item.roleTitle}</p>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="truncate">{meta}</span>
        <span className="shrink-0">
          {item.pendingReviews > 0 && <span className="mr-2 font-medium text-amber-600 dark:text-amber-400">● review</span>}
          {item.appliedOn ? `${formatDate(item.appliedOn)} · ${relativeDays(item.appliedOn)}` : 'Saved'}
        </span>
      </div>
    </Link>
  );
}
