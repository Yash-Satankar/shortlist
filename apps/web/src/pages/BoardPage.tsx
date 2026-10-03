import { APPLICATION_STATUSES, type ApplicationStatus } from '@jt/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { keys, useApplications } from '../api/hooks';
import type { ApplicationDetail, ApplicationListItem } from '../api/types';
import { Icon } from '../components/Icon';
import { ErrorNote, Spinner, StatusGlyph, useToast } from '../components/ui';
import { shortAge } from '../lib/format';
import { sourceShort, STATUS_SHORT } from '../lib/status';
import { latestEffective } from '../lib/timeline';
import { FLAG, useRowMarkers, type Marker } from './ApplicationsPage';

const BOARD_PARAMS = new URLSearchParams({ limit: '500', sort: 'updated_desc' });
const COLLAPSE_KEY = 'jt-board-collapsed';
const DEFAULT_COLLAPSED: ApplicationStatus[] = ['rejected', 'ghosted', 'withdrawn'];
const CARD_LIMIT = 40; // per column before "+ N more", keeps long Applied/Rejected piles light

const desktopQuery = () => window.matchMedia('(min-width: 768px)');
function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => (desktopQuery().addEventListener('change', cb), () => desktopQuery().removeEventListener('change', cb)),
    () => desktopQuery().matches,
  );
}

function useCollapsed(): [ApplicationStatus[], (s: ApplicationStatus) => void, (all: ApplicationStatus[]) => void] {
  const [collapsed, setCollapsed] = useState<ApplicationStatus[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? 'null');
      return Array.isArray(v) ? v : DEFAULT_COLLAPSED;
    } catch {
      return DEFAULT_COLLAPSED;
    }
  });
  const save = (next: ApplicationStatus[]) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  return [collapsed, (s) => save(collapsed.includes(s) ? collapsed.filter((x) => x !== s) : [...collapsed, s]), save];
}

/**
 * Kanban. Dropping a card calls the same POST /applications/:id/status endpoint as the
 * status sheet: a manual change that lands on the timeline and can be undone.
 *
 * Phones: a status strip (tap to jump) over snapping columns that peek the next one. A
 * long-press lifts a card and turns the top into a 5×2 grid of drop targets, so any move
 * is one short drag up. Desktop: classic columns; Saved and closed ones collapse to rails.
 */
export function BoardPage() {
  const { data, isPending, error, refetch } = useApplications(BOARD_PARAMS);
  const isDesktop = useIsDesktop();
  const [dragging, setDragging] = useState<ApplicationListItem | null>(null);
  const [overTile, setOverTile] = useState<ApplicationStatus | null>(null);
  const [filter, setFilter] = useState('');
  const [collapsed, toggleCollapsed, setCollapsedAll] = useCollapsed();
  const [active, setActive] = useState<ApplicationStatus>('applied');
  const scroller = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const move = useMoveCard();
  const marker = useRowMarkers();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to lift on phones, so horizontal swipes still scroll the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = data?.items ?? [];
    return q ? all.filter((i) => `${i.companyName} ${i.roleTitle} ${i.location ?? ''}`.toLowerCase().includes(q)) : all;
  }, [data, filter]);

  const columns = useMemo(() => APPLICATION_STATUSES.map((status) => ({ status, items: items.filter((i) => i.status === status) })), [items]);

  // Phones: highlight the strip chip for the column in view.
  useEffect(() => {
    const root = scroller.current;
    if (!root || isDesktop) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit) setActive((hit.target as HTMLElement).dataset.status as ApplicationStatus);
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll('[data-status]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [isDesktop, isPending]);

  // Keep the active chip visible in the strip.
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    const bar = strip.current;
    if (chip && bar) bar.scrollTo({ left: chip.offsetLeft - 16, behavior: 'smooth' });
  }, [active]);

  const jump = (s: ApplicationStatus) => {
    setActive(s);
    scroller.current?.querySelector(`[data-status="${s}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  const onDragStart = (e: DragStartEvent) => {
    setDragging((e.active.data.current?.item as ApplicationListItem) ?? null);
    navigator.vibrate?.(12);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    setOverTile(null);
    const item = e.active.data.current?.item as ApplicationListItem | undefined;
    const to = e.over?.data.current?.status as ApplicationStatus | undefined;
    if (item && to && to !== item.status) move(item, to);
  };

  const closedCollapsed = DEFAULT_COLLAPSED.every((s) => collapsed.includes(s));

  return (
    <div className="pt-safe flex flex-col md:h-dvh">
      <header className="hdr md:px-6 md:pt-3.5 md:pb-3">
        <h1 className="h1 md:text-xl">Board</h1>
        {data && <span className="count">{data.total}</span>}
        <span className="sp" />
        <label className="search hidden h-[34px] w-[260px] md:flex">
          <Icon name="search" size="sm" />
          <span className="vh">Filter cards</span>
          <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter cards" className="text-[13.5px]" />
        </label>
        <button
          type="button"
          className={`chip hidden h-[34px] text-[13px] md:inline-flex ${closedCollapsed ? 'on' : ''}`}
          aria-pressed={closedCollapsed}
          onClick={() => setCollapsedAll(closedCollapsed ? collapsed.filter((s) => !DEFAULT_COLLAPSED.includes(s)) : [...new Set([...collapsed, ...DEFAULT_COLLAPSED])])}
        >
          Closed collapsed
        </button>
      </header>

      {error && (
        <div className="px-4">
          <ErrorNote error={error} onRetry={() => void refetch()} />
        </div>
      )}

      {isPending ? (
        <Spinner />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragOver={(e) => setOverTile((e.over?.data.current?.tile && (e.over.data.current.status as ApplicationStatus)) || null)}
          onDragEnd={onDragEnd}
          onDragCancel={() => (setDragging(null), setOverTile(null))}
        >
          {/* Phones: status strip, or the drop grid while a card is lifted */}
          {!isDesktop &&
            (dragging ? (
              <DropGrid current={dragging.status} company={dragging.companyName} over={overTile} />
            ) : (
              <div ref={strip} className="kstrip no-scrollbar relative scroll-px-4 overflow-x-auto" role="tablist" aria-label="Jump to status">
                {columns.map((c) => (
                  <button
                    key={c.status}
                    data-chip={c.status}
                    type="button"
                    role="tab"
                    aria-selected={active === c.status}
                    className={`kchip st-${c.status} ${active === c.status ? 'on' : ''}`}
                    onClick={() => jump(c.status)}
                  >
                    <StatusGlyph />
                    {STATUS_SHORT[c.status]}
                    <span className="n">{c.items.length}</span>
                  </button>
                ))}
              </div>
            ))}

          <div
            ref={scroller}
            className="no-scrollbar flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 items-start gap-2.5 md:items-stretch overflow-x-auto px-4 pt-1 pb-3 md:snap-none md:pr-6 md:pb-4 md:pl-6"
          >
            {columns.map((c) =>
              isDesktop && collapsed.includes(c.status) ? (
                <CollapsedColumn key={c.status} status={c.status} count={c.items.length} onExpand={() => toggleCollapsed(c.status)} />
              ) : (
                <Column
                  key={c.status}
                  status={c.status}
                  items={c.items}
                  marker={marker}
                  dropEnabled={isDesktop}
                  onCollapse={isDesktop ? () => toggleCollapsed(c.status) : undefined}
                />
              ),
            )}
          </div>

          <DragOverlay>{dragging && <CardBody item={dragging} marker={marker(dragging)} lifted />}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function DropGrid({ current, company, over }: { current: ApplicationStatus; company: string; over: ApplicationStatus | null }) {
  return (
    <div className="relative z-10 bg-surface px-4 pt-2 pb-3 shadow-[0_1px_0_var(--line),var(--shadow-2)]">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">Move {company} to…</span>
        <span className="hint flex-none">Drag back to cancel</span>
      </div>
      <div className="drop mt-2">
        {APPLICATION_STATUSES.map((s) => (
          <DropTile key={s} status={s} current={s === current} hot={s === over} />
        ))}
      </div>
    </div>
  );
}

function DropTile({ status, current, hot }: { status: ApplicationStatus; current: boolean; hot: boolean }) {
  const { setNodeRef } = useDroppable({ id: `tile:${status}`, data: { status, tile: true }, disabled: current });
  const short = status === 'assessment' ? 'Assess.' : status === 'withdrawn' ? 'Withdrew' : STATUS_SHORT[status];
  return (
    <span ref={setNodeRef} className={`dt st-${status} ${hot ? 'hot' : ''} ${current ? 'cur' : ''}`} aria-label={STATUS_SHORT[status]}>
      <StatusGlyph />
      {short}
    </span>
  );
}

function CollapsedColumn({ status, count, onExpand }: { status: ApplicationStatus; count: number; onExpand: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { status } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onExpand}
      className={`kcol st-${status} h-full w-[52px] cursor-pointer items-center gap-2.5 border-0 pt-3.5 text-ink shadow-[inset_0_3px_0_var(--solid)] ${isOver ? 'outline-2 outline-[var(--fg)]' : ''}`}
      aria-label={`${STATUS_SHORT[status]}, ${count}. Expand column`}
    >
      <span className="text-[var(--fg)]">
        <StatusGlyph />
      </span>
      <span className="text-[13px] leading-none font-bold [writing-mode:vertical-rl]">{STATUS_SHORT[status]}</span>
      <span className="font-mono text-xs text-ink-3">{count}</span>
    </button>
  );
}

function Column({
  status,
  items,
  marker,
  dropEnabled,
  onCollapse,
}: {
  status: ApplicationStatus;
  items: ApplicationListItem[];
  marker: (i: ApplicationListItem) => Marker;
  dropEnabled: boolean;
  onCollapse?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { status }, disabled: !dropEnabled });
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, CARD_LIMIT);
  return (
    <section
      ref={setNodeRef}
      data-status={status}
      aria-label={`${STATUS_SHORT[status]}, ${items.length} applications`}
      className={`kcol st-${status} max-h-full w-[min(316px,calc(100vw-74px))] snap-start md:w-[200px] ${isOver ? 'outline-2 outline-[var(--fg)]' : ''}`}
    >
      <div className="kh md:h-[42px] md:text-[13px]">
        <StatusGlyph />
        {STATUS_SHORT[status]}
        <span className="n">{items.length}</span>
        <span className="sp" />
        {onCollapse && (
          <button type="button" className="iconbtn h-8 w-8" aria-label={`Collapse ${STATUS_SHORT[status]}`} onClick={onCollapse}>
            <Icon name="chevron" size="sm" className="rotate-90" />
          </button>
        )}
      </div>
      <ul className="kbody m-0 min-h-24 list-none overflow-y-auto md:gap-1.5 md:px-1.5 md:pb-2">
        {shown.map((item) => (
          <DraggableCard key={item.id} item={item} marker={marker(item)} />
        ))}
        {items.length > shown.length && (
          <li>
            <button type="button" className="btn btn-quiet btn-sm w-full text-ink-3" onClick={() => setShowAll(true)}>
              + {items.length - shown.length} more
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function DraggableCard({ item, marker }: { item: ApplicationListItem; marker: Marker }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: item.id, data: { item } });
  return (
    <li ref={setNodeRef} {...attributes} {...listeners} className="touch-manipulation select-none [-webkit-touch-callout:none]">
      {isDragging ? (
        <div className="kcard ghostslot" aria-hidden="true" />
      ) : (
        <Link to={`/applications/${item.id}`} draggable={false} className="block">
          <CardBody item={item} marker={marker} />
        </Link>
      )}
    </li>
  );
}

function CardBody({ item, marker, lifted = false }: { item: ApplicationListItem; marker: Marker; lifted?: boolean }) {
  return (
    <article className={`kcard ${lifted ? 'lift' : ''} md:px-2.5 md:pt-2 md:pb-[9px]`}>
      <div className="r1">
        <span className="co md:text-sm md:leading-[19px]">{item.companyName}</span>
        {marker && <span className={`flag ${marker} md:hidden`}>{FLAG[marker]}</span>}
        {marker && <span className={`mk ${marker} hidden md:block`} aria-label={FLAG[marker]} />}
        {lifted && <Icon name="grip" size="sm" className="text-ink-3" />}
      </div>
      <div className="role md:line-clamp-2 md:text-[12.5px] md:leading-[17px] md:whitespace-normal">{item.roleTitle}</div>
      <div className="meta md:text-[11.5px]">
        <span className="min-w-0 truncate">{item.location?.split(',')[0] || '—'}</span>
        <span className="dim md:hidden">·</span>
        <span className="md:hidden">{sourceShort(item.source)}</span>
        <span className="sp" />
        <span className="age md:text-[11px]">{shortAge(item.appliedOn ?? item.createdAt)}</span>
      </div>
    </article>
  );
}

/** Optimistic move: the card jumps columns immediately; failure rolls back. Success offers Undo. */
function useMoveCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const listKey = keys.applications(BOARD_PARAMS.toString());

  return (item: ApplicationListItem, to: ApplicationStatus) => {
    const previous = qc.getQueryData<{ items: ApplicationListItem[]; total: number }>(listKey);
    if (previous) {
      qc.setQueryData(listKey, { ...previous, items: previous.items.map((i) => (i.id === item.id ? { ...i, status: to } : i)) });
    }
    api<{ application: ApplicationDetail }>(`/applications/${item.id}/status`, { method: 'POST', json: { status: to } })
      .then(({ application }) => {
        qc.setQueryData(keys.application(item.id), application);
        void qc.invalidateQueries({ queryKey: ['applications'] });
        void qc.invalidateQueries({ queryKey: keys.followUps });
        const last = latestEffective(application.timeline);
        toast({
          message: (
            <>
              {item.companyName} moved to <b>{STATUS_SHORT[to]}</b>
            </>
          ),
          tone: 'info',
          action: last ? { label: 'Undo', run: () => void undoMove(item.id, last.id) } : undefined,
        });
      })
      .catch((err: Error) => {
        if (previous) qc.setQueryData(listKey, previous);
        toast({ message: err.message, tone: 'error' });
      });
  };

  async function undoMove(id: string, eventId: string) {
    await api(`/applications/${id}/events/${eventId}/undo`, { method: 'POST' });
    void qc.invalidateQueries({ queryKey: ['applications'] });
    void qc.invalidateQueries({ queryKey: keys.application(id) });
    void qc.invalidateQueries({ queryKey: keys.followUps });
  }
}
