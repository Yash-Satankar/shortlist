import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from '@jt/shared';
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
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { keys, useApplications } from '../api/hooks';
import type { ApplicationDetail, ApplicationListItem } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ErrorNote, Spinner, useToast } from '../components/ui';
import { relativeDays, STATUS_STYLES } from '../lib/format';
import { latestEffective } from '../lib/timeline';

const CLOSED: ApplicationStatus[] = ['rejected', 'ghosted', 'withdrawn'];
const BOARD_PARAMS = new URLSearchParams({ limit: '500', sort: 'updated_desc' });

/**
 * Kanban. Dropping a card calls the same POST /applications/:id/status endpoint as
 * the status sheet. From the web app that is always a manual change (source "manual"),
 * so it applies directly, lands on the timeline, and can be undone.
 */
export function BoardPage() {
  const { data, isPending, error } = useApplications(BOARD_PARAMS);
  const [showClosed, setShowClosed] = useState(false);
  const [dragging, setDragging] = useState<ApplicationListItem | null>(null);
  const move = useMoveCard();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to drag on phones, so horizontal swipes still scroll the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const columns = useMemo(() => {
    const statuses = APPLICATION_STATUSES.filter((s) => showClosed || !CLOSED.includes(s));
    return statuses.map((status) => ({ status, items: (data?.items ?? []).filter((i) => i.status === status) }));
  }, [data, showClosed]);

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.item as ApplicationListItem) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const item = e.active.data.current?.item as ApplicationListItem | undefined;
    const to = e.over?.id as ApplicationStatus | undefined;
    if (item && to && to !== item.status) move(item, to);
  };

  const closedCount = (data?.items ?? []).filter((i) => CLOSED.includes(i.status)).length;

  return (
    <>
      <PageHeader
        title="Board"
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="h-4 w-4" />
            Closed ({closedCount})
          </label>
        }
      />
      <ErrorNote error={error} />
      {isPending ? (
        <Spinner />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4 md:snap-none">
            {columns.map((col) => (
              <Column key={col.status} status={col.status} items={col.items} />
            ))}
          </div>
          <DragOverlay>{dragging && <CardBody item={dragging} lifted />}</DragOverlay>
        </DndContext>
      )}
      <p className="px-4 pb-4 text-xs text-slate-500 md:hidden">Press and hold a card to drag it.</p>
    </>
  );
}

function Column({ status, items }: { status: ApplicationStatus; items: ApplicationListItem[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_LABELS[status]} column`}
      className={`flex w-[80vw] max-w-72 shrink-0 snap-start flex-col rounded-xl p-2 transition-colors sm:w-64 ${
        isOver ? 'bg-sky-100 ring-2 ring-sky-400 dark:bg-sky-950' : 'bg-slate-100 dark:bg-slate-900/60'
      }`}
    >
      <header className="flex items-center justify-between px-1 pb-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>
        <span className="text-xs text-slate-500">{items.length}</span>
      </header>
      <ul className="min-h-24 space-y-2">
        {items.map((item) => (
          <DraggableCard key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function DraggableCard({ item }: { item: ApplicationListItem }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: item.id, data: { item } });
  return (
    <li ref={setNodeRef} {...attributes} {...listeners} className={`touch-manipulation ${isDragging ? 'opacity-30' : ''}`}>
      <Link to={`/applications/${item.id}`} draggable={false} className="block">
        <CardBody item={item} />
      </Link>
    </li>
  );
}

function CardBody({ item, lifted = false }: { item: ApplicationListItem; lifted?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white px-3 py-2 select-none dark:border-slate-700 dark:bg-slate-800 ${
        lifted ? 'rotate-2 shadow-xl' : 'shadow-sm'
      }`}
    >
      <p className="truncate text-sm font-semibold">{item.companyName}</p>
      <p className="truncate text-xs text-slate-600 dark:text-slate-300">{item.roleTitle}</p>
      <p className="mt-1 text-[11px] text-slate-500">
        {item.pendingReviews > 0 && <span className="mr-1 text-amber-600">● review</span>}
        {item.appliedOn ? `applied ${relativeDays(item.appliedOn)}` : 'saved'}
      </p>
    </div>
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
          message: `${item.companyName} → ${STATUS_LABELS[to]}`,
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
  }
}
