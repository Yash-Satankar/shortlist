import { APPLICATION_SOURCES, WORK_MODE_LABELS, type ApplicationSource, type ApplicationStatus } from '@jt/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useMatch, useSearchParams } from 'react-router';
import { useApplications, useFollowUps } from '../api/hooks';
import type { ApplicationListItem } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, EmptyState, ErrorNote, Segmented, Sheet, SkeletonRows, StatusGlyph, StatusPill } from '../components/ui';
import { daysAgo, formatDate, shortAge } from '../lib/format';
import { useVisibleGhosts } from '../lib/ghost';
import { ACTIVE_STATUSES, CLOSED_STATUSES, sourceShort, STATUS_GROUPS, STATUS_SHORT } from '../lib/status';

// ---------------------------------------------------------------- filter state

type SortId = 'updated' | 'applied' | 'company';
type DateId = '7' | '30' | '90' | 'any';

interface ListFilters {
  statuses: ApplicationStatus[]; // empty = all
  cities: string[];
  sources: ApplicationSource[];
  date: DateId;
  sort: SortId;
}

const NO_FILTERS: ListFilters = { statuses: [], cities: [], sources: [], date: 'any', sort: 'updated' };
const SORT_PARAM: Record<SortId, string> = { updated: 'updated_desc', applied: 'applied_desc', company: 'company_asc' };
const SORT_LABEL: Record<SortId, string> = { updated: 'Recent activity', applied: 'Applied', company: 'Company' };
const STORE_KEY = 'jt-list-filters';

/** Filters survive opening a detail and coming back (this tab only). */
function useListFilters(): [ListFilters, (f: ListFilters) => void] {
  const [filters, setFilters] = useState<ListFilters>(() => {
    try {
      return { ...NO_FILTERS, ...JSON.parse(sessionStorage.getItem(STORE_KEY) ?? '{}') };
    } catch {
      return NO_FILTERS;
    }
  });
  const set = (f: ListFilters) => {
    setFilters(f);
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(f));
    } catch {
      // ignore
    }
  };
  return [filters, set];
}

/** "Bengaluru, Karnataka" → "Bengaluru"; remote roles group under "Remote". */
function cityOf(item: ApplicationListItem): string | null {
  if (item.workMode === 'remote' || /remote/i.test(item.location ?? '')) return 'Remote';
  const first = item.location?.split(/[,(/]/)[0]?.trim();
  return first || null;
}

function matches(item: ApplicationListItem, f: ListFilters, except?: keyof ListFilters): boolean {
  if (except !== 'statuses' && f.statuses.length && !f.statuses.includes(item.status)) return false;
  if (except !== 'cities' && f.cities.length && !f.cities.includes(cityOf(item) ?? '')) return false;
  if (except !== 'sources' && f.sources.length && !f.sources.includes(item.source)) return false;
  if (except !== 'date' && f.date !== 'any') {
    const day = item.appliedOn ?? item.createdAt;
    if (daysAgo(day) > Number(f.date)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- split view

/**
 * "/" and "/applications/:id". Phones show one or the other; md+ shows the list column
 * beside the detail. The list stays mounted, so filters and scroll survive opening a detail.
 */
export function ApplicationsSplit() {
  const detail = useMatch('/applications/:id');
  return (
    <div className="md:flex md:h-dvh">
      <div className={`${detail ? 'hidden' : 'block'} md:block md:w-[var(--list-w)] md:flex-none md:overflow-y-auto md:shadow-[inset_-1px_0_0_var(--line)]`}>
        <ApplicationsList selectedId={detail?.params.id} />
      </div>
      <div className={`${detail ? 'block' : 'hidden'} min-w-0 md:block md:flex-1 md:overflow-y-auto md:bg-surface`}>
        <Outlet />
      </div>
    </div>
  );
}

export function NoSelection() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState icon="list" title="Select an application">
        <span className="hidden md:inline">
          <span className="kbd">/</span> search · <span className="kbd">N</span> add
        </span>
      </EmptyState>
    </div>
  );
}

// ---------------------------------------------------------------- list

function ApplicationsList({ selectedId }: { selectedId?: string }) {
  const [filters, setFilters] = useListFilters();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // Sidebar "Active pipeline" view: /?view=active presets the status filter once.
  useEffect(() => {
    if (params.get('view') === 'active') {
      setFilters({ ...filters, statuses: ACTIVE_STATUSES });
      setParams({}, { replace: true });
    }
  }, [params, filters, setFilters, setParams]);

  // Debounce typing. Search runs on the server (it covers JD text and answers too).
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Shadow under the sticky search once the title has scrolled away.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry && setScrolled(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const apiParams = useMemo(() => {
    const p = new URLSearchParams({ limit: '500', sort: SORT_PARAM[filters.sort] });
    if (query) p.set('q', query);
    return p;
  }, [filters.sort, query]);

  const { data, isPending, error, isFetching, refetch } = useApplications(apiParams);
  const marker = useRowMarkers();

  const all = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => all.filter((i) => matches(i, filters)), [all, filters]);
  const groups = useMemo(() => groupRows(visible, filters.sort), [visible, filters.sort]);
  const filtered = filters.statuses.length + filters.cities.length + filters.sources.length > 0 || filters.date !== 'any';

  const chip = (label: string, active: string[] | boolean, icon = false) => {
    const on = Array.isArray(active) ? active.length > 0 : active;
    const text = Array.isArray(active) && active.length ? (active.length > 2 ? `${label} · ${active.length}` : active.join(', ')) : label;
    return (
      <button type="button" className={`chip ${on ? 'on' : ''} md:h-[30px] md:text-[12.5px]`} onClick={() => setSheetOpen(true)}>
        {icon && <Icon name="filter" />}
        {text}
      </button>
    );
  };

  return (
    <>
      <div className="pt-safe">
        <header className="hdr md:min-h-0 md:pt-4">
          <h1 className="h1 md:text-xl">Applications</h1>
          {data && <span className="count">{filtered || query ? `${visible.length} / ${data.total}` : data.total}</span>}
          <span className="sp" />
          <button type="button" className="iconbtn md:hidden" aria-label={`Sort: ${SORT_LABEL[filters.sort]}`} onClick={() => setSheetOpen(true)}>
            <Icon name="sort" />
          </button>
          <Button variant="quiet" size="sm" className="hidden md:inline-flex" onClick={() => setSheetOpen(true)}>
            <Icon name="sort" size="sm" />
            {SORT_LABEL[filters.sort]}
          </Button>
        </header>
      </div>
      <div ref={sentinel} />

      <div className={`sticky top-safe z-20 bg-bg md:top-0 ${scrolled ? 'shadow-[0_1px_0_var(--line)]' : ''}`}>
        <div className="flex items-center gap-1 px-4 pt-1.5 md:pt-2.5">
          <label className="search flex-1 md:h-[38px]">
            <Icon name="search" />
            <span className="vh">Search applications</span>
            <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={scrolled && data ? `Search ${data.total} applications` : 'Company, role or city'} />
            <span className="kbd mr-1.5 hidden md:inline">/</span>
          </label>
        </div>
        <div className="chips no-scrollbar overflow-x-auto md:gap-1.5" role="toolbar" aria-label="Filters">
          {chip('Status', filters.statuses.map((s) => STATUS_SHORT[s]), true)}
          {chip('City', filters.cities)}
          {chip('Source', filters.sources.map(sourceShort))}
          {chip(filters.date === 'any' ? 'Any date' : `Last ${filters.date} days`, filters.date !== 'any')}
        </div>
      </div>

      <main className={`pb-4 transition-opacity ${isFetching && !isPending ? 'opacity-70' : ''}`}>
        {error && (
          <div className="px-4 pt-2">
            <ErrorNote error={error} onRetry={() => void refetch()} />
          </div>
        )}
        {isPending ? (
          <div className="pt-4">
            <SkeletonRows count={6} />
          </div>
        ) : all.length === 0 && !query ? (
          <EmptyState icon="list" title="Nothing here yet" action={<Link to="/add" className="btn btn-primary">Add an application</Link>}>
            Log the first job you apply to.
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="search"
            title="No applications match"
            action={
              <Button
                onClick={() => {
                  setFilters({ ...NO_FILTERS, sort: filters.sort });
                  setQ('');
                }}
              >
                Clear filters
              </Button>
            }
          >
            {query ? `“${query}”` : 'Try fewer filters.'}
          </EmptyState>
        ) : (
          groups.map((g) => (
            <section key={g.title} aria-label={g.title}>
              <div className="sect">
                {g.title} <span className="n">· {g.rows.length}</span>
              </div>
              <div className="list">
                {g.rows.map((item) => (
                  <Row key={item.id} item={item} marker={marker(item)} selected={item.id === selectedId} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} items={all} filters={filters} onChange={setFilters} />
    </>
  );
}

function groupRows(rows: ApplicationListItem[], sort: SortId): Array<{ title: string; rows: ApplicationListItem[] }> {
  if (sort === 'company') return rows.length ? [{ title: 'A–Z', rows }] : [];
  const when = (i: ApplicationListItem) => (sort === 'applied' ? (i.appliedOn ?? i.createdAt) : i.lastActivityAt);
  const buckets = [
    { title: 'Today', rows: [] as ApplicationListItem[] },
    { title: 'This week', rows: [] as ApplicationListItem[] },
    { title: 'Earlier', rows: [] as ApplicationListItem[] },
  ];
  for (const r of rows) {
    const d = daysAgo(when(r));
    buckets[d <= 0 ? 0 : d < 7 ? 1 : 2]!.rows.push(r);
  }
  return buckets.filter((b) => b.rows.length);
}

// ---------------------------------------------------------------- row

export type Marker = '' | 'due' | 'rev' | 'ghost';
export const FLAG: Record<Exclude<Marker, ''>, string> = { due: 'Follow up', rev: 'Review', ghost: 'Ghosted?' };

/** Gutter marker per row: pending review beats follow-up due beats ghost suggestion. */
export function useRowMarkers() {
  const followUps = useFollowUps();
  const ghosts = useVisibleGhosts(followUps.data?.ghostSuggestions);
  const dueIds = useMemo(() => new Set(followUps.data?.followUps.map((f) => f.id)), [followUps.data]);
  const ghostIds = useMemo(() => new Set(ghosts.map((g) => g.id)), [ghosts]);
  return (item: ApplicationListItem): Marker => (item.pendingReviews > 0 ? 'rev' : dueIds.has(item.id) ? 'due' : ghostIds.has(item.id) ? 'ghost' : '');
}

export function placeLine(item: Pick<ApplicationListItem, 'location' | 'workMode'>): string {
  const mode = item.workMode !== 'unknown' ? WORK_MODE_LABELS[item.workMode] : null;
  // Avoid "Remote · Remote" when the location itself says Remote.
  const showMode = mode && !(item.location ?? '').toLowerCase().includes(mode.toLowerCase());
  return [item.location?.split(',')[0], showMode ? mode : null].filter(Boolean).join(' · ') || '—';
}

export function Row({ item, marker, selected }: { item: ApplicationListItem; marker: Marker; selected?: boolean }) {
  const day = item.appliedOn ?? item.createdAt;
  return (
    <Link to={`/applications/${item.id}`} className={`row ${selected ? 'sel' : ''} md:min-h-[68px] md:py-[9px]`} aria-current={selected ? 'page' : undefined}>
      <span className="gut">
        <span className={`mk ${marker}`} />
      </span>
      <span className="rb">
        <span className="r1">
          <span className="co md:text-[15px] md:leading-5">{item.companyName}</span>
          <StatusPill status={item.status} />
        </span>
        <span className="role md:text-[13px] md:leading-[18px]">{item.roleTitle}</span>
        <span className="meta md:text-xs">
          <span className="min-w-0 truncate">{placeLine(item)}</span>
          <span className="dim">·</span>
          <span>{sourceShort(item.source)}</span>
          <span className="sp" />
          {marker && <span className={`flag ${marker}`}>{FLAG[marker]}</span>}
          <span className="age md:hidden" title={formatDate(day)}>
            {shortAge(day)}
          </span>
          <span className="age hidden md:inline">
            {item.appliedOn ? 'Applied' : 'Saved'} {formatDate(day)}
          </span>
        </span>
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------- filter sheet

function FilterSheet({
  open,
  onClose,
  items,
  filters,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  items: ApplicationListItem[];
  filters: ListFilters;
  onChange: (f: ListFilters) => void;
}) {
  const count = (key: keyof ListFilters, test: (i: ApplicationListItem) => boolean) => items.filter((i) => matches(i, filters, key) && test(i)).length;

  const cities = useMemo(() => {
    const tally = new Map<string, number>();
    for (const i of items) {
      const c = cityOf(i);
      if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
    return [...new Set([...filters.cities, ...top])];
  }, [items, filters.cities]);

  const sources = APPLICATION_SOURCES.filter((s) => filters.sources.includes(s) || items.some((i) => i.source === s));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const result = items.filter((i) => matches(i, filters)).length;

  const preset = (statuses: ApplicationStatus[]) => onChange({ ...filters, statuses });
  const samePreset = (s: ApplicationStatus[]) => s.length === filters.statuses.length && s.every((x) => filters.statuses.includes(x));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filter & sort"
      headerAction={
        <Button variant="quiet" onClick={() => onChange({ ...NO_FILTERS })}>
          Reset
        </Button>
      }
      footer={
        <Button variant="ink" size="block" onClick={onClose}>
          Show {result} application{result === 1 ? '' : 's'}
        </Button>
      }
    >
      <div className="flex flex-col gap-[18px] px-4 pb-4">
        <div>
          <div className="sect px-0 pt-1 pb-2">
            Status
            <span className="act flex gap-1">
              {(
                [
                  ['Active', ACTIVE_STATUSES],
                  ['Closed', CLOSED_STATUSES],
                  ['All', []],
                ] as const
              ).map(([label, s]) => (
                <button
                  key={label}
                  type="button"
                  className={`rounded-md px-1.5 py-1 ${samePreset([...s]) ? 'font-semibold text-ink underline underline-offset-4' : ''}`}
                  onClick={() => preset([...s])}
                >
                  {label}
                </button>
              ))}
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {STATUS_GROUPS.map((g) => (
              <div key={g.id}>
                <div className="hint mb-2">{g.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.statuses.map((s) => {
                    const on = filters.statuses.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        className={`kchip st-${s} ${on ? 'on' : ''}`}
                        onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, s) })}
                      >
                        <StatusGlyph />
                        {STATUS_SHORT[s]}
                        <span className="n">{count('statuses', (i) => i.status === s)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {cities.length > 0 && (
          <div>
            <div className="sect px-0 pt-1 pb-2">City</div>
            <div className="flex flex-wrap gap-1.5">
              {cities.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={filters.cities.includes(c)}
                  className={`chip ${filters.cities.includes(c) ? 'on' : ''}`}
                  onClick={() => onChange({ ...filters, cities: toggle(filters.cities, c) })}
                >
                  {c} <span className="n">{count('cities', (i) => cityOf(i) === c)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {sources.length > 0 && (
          <div>
            <div className="sect px-0 pt-1 pb-2">Source</div>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={filters.sources.includes(s)}
                  className={`chip ${filters.sources.includes(s) ? 'on' : ''}`}
                  onClick={() => onChange({ ...filters, sources: toggle(filters.sources, s) })}
                >
                  {sourceShort(s)} <span className="n">{count('sources', (i) => i.source === s)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="sect px-0 pt-1 pb-2">Applied</div>
          <Segmented<DateId>
            label="Applied within"
            value={filters.date}
            onChange={(date) => onChange({ ...filters, date })}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: 'any', label: 'Any' },
            ]}
          />
        </div>

        <div>
          <div className="sect px-0 pt-1 pb-2">Sort by</div>
          <Segmented<SortId>
            label="Sort by"
            value={filters.sort}
            onChange={(sort) => onChange({ ...filters, sort })}
            options={[
              { value: 'updated', label: 'Recent activity' },
              { value: 'applied', label: 'Applied' },
              { value: 'company', label: 'Company' },
            ]}
          />
        </div>
      </div>
    </Sheet>
  );
}
