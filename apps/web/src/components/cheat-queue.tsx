'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import type { CheatMealView, MealSlot } from '@life-portal/shared-types';
import { mgToG } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { EmptyState } from './ui';

/**
 * The cheat-day priority list.
 *
 * Reordering uses native HTML5 drag events plus ↑/↓ buttons — no drag-and-drop library, which
 * the constitution would want justified in writing for one list of a handful of rows. The buttons
 * are not a fallback afterthought either: they are how this works on a phone and by keyboard.
 *
 * The order is posted as the full id array, exactly as the boards widget does.
 */
export function CheatQueue({
  queue,
  canLog,
  logSlot,
  logDay,
  onChanged,
}: {
  queue: CheatMealView[];
  /** Only true on an actual cheat day — the whole point is that it waits. */
  canLog: boolean;
  logSlot: MealSlot;
  logDay: string;
  onChanged?: () => void;
}) {
  const { run, pending } = useAction();
  const [rows, setRows] = useState(queue);
  const [dragging, setDragging] = useState<string | null>(null);

  // The server owns the order; local state exists only so a drag feels immediate.
  useEffect(() => setRows(queue), [queue]);

  const commit = (next: CheatMealView[]) => {
    setRows(next);
    void run(async () => {
      await api.post('/nutrition/cheat/order', { order: next.map((row) => row.id) });
    }).then((ok) => {
      if (ok) onChanged?.();
    });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    commit(next);
  };

  const drop = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const from = rows.findIndex((row) => row.id === dragging);
    const to = rows.findIndex((row) => row.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDragging(null);
    commit(next);
  };

  const remove = (id: string) =>
    void run(async () => api.delete(`/nutrition/cheat/${id}`)).then((ok) => {
      if (ok) onChanged?.();
    });

  const requeue = (id: string) =>
    void run(async () => api.patch(`/nutrition/cheat/${id}`, { eaten: false })).then((ok) => {
      if (ok) onChanged?.();
    });

  const log = (id: string) =>
    void run(async () =>
      api.post(`/nutrition/cheat/${id}/log`, { day: logDay, slot: logSlot }),
    ).then((ok) => {
      if (ok) onChanged?.();
    });

  if (rows.length === 0) {
    return (
      <EmptyState message="Nothing queued. Add what you actually want, in the order you want it — that is the point of the list." />
    );
  }

  return (
    <ol className="space-y-2">
      {rows.map((row, index) => (
        <li
          key={row.id}
          draggable={!row.eaten}
          onDragStart={() => setDragging(row.id)}
          onDragEnd={() => setDragging(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => drop(row.id)}
          className={clsx(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
            row.eaten
              ? 'border-border/60 bg-surface/40 text-ink-faint'
              : 'border-border bg-surface hover:border-ink-faint',
            dragging === row.id && 'opacity-50',
          )}
        >
          <span className="tabular w-5 shrink-0 text-center text-xs text-ink-faint">
            {index + 1}
          </span>

          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              className="text-xs text-ink-faint hover:text-ink disabled:opacity-30"
              onClick={() => move(index, -1)}
              disabled={index === 0 || pending}
              aria-label={`Move ${row.name ?? 'item'} up`}
            >
              ▲
            </button>
            <button
              type="button"
              className="text-xs text-ink-faint hover:text-ink disabled:opacity-30"
              onClick={() => move(index, 1)}
              disabled={index === rows.length - 1 || pending}
              aria-label={`Move ${row.name ?? 'item'} down`}
            >
              ▼
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <p className={clsx('truncate', row.eaten && 'line-through')}>
              {row.missing ? 'A food that no longer exists' : row.name}
              {row.brand && <span className="ml-1 text-xs text-ink-faint">{row.brand}</span>}
            </p>
            <p className="text-xs text-ink-faint">
              {row.missing ? (
                'Replace or remove this row — it cannot be logged.'
              ) : (
                <>
                  {row.amount} {row.unit}
                  {row.totals && (
                    <>
                      {' · '}
                      <span className="tabular">{row.totals.energyKcal} kcal</span>
                      {' · P '}
                      {mgToG(row.totals.proteinMg)}g C {mgToG(row.totals.carbMg)}g F{' '}
                      {mgToG(row.totals.fatMg)}g
                    </>
                  )}
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {row.eaten ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => requeue(row.id)}
                disabled={pending}
              >
                Queue again
              </button>
            ) : (
              canLog &&
              !row.missing && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => log(row.id)}
                  disabled={pending}
                >
                  Log it
                </button>
              )
            )}
            <button
              type="button"
              className="text-xs text-ink-faint hover:text-rose-300"
              onClick={() => remove(row.id)}
              disabled={pending}
              aria-label={`Remove ${row.name ?? 'item'}`}
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}
