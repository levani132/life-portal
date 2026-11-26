'use client';

import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { SessionListItem } from '@life-portal/shared-types';
import { weekdayOf } from '@life-portal/shared-domain';
import { formatDuration } from '../../lib/training';

/** Decoration only: each weekday keeps one colour, so a week reads as a row of colours. */
const DAY_BLOCKS = [
  'bg-train-cardio/10 text-train-cardio',
  'bg-train-pull/10 text-train-pull',
  'bg-train-push/10 text-train-push',
  'bg-train-legs/10 text-train-legs',
  'bg-train-arms/10 text-train-arms',
  'bg-train-core/10 text-train-core',
  'bg-train-pull/10 text-train-pull',
] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * One workout as History lists it. Training passes `onOpen`; a portal (spec 046) shows the same
 * row read only, without an id to open.
 */
export function HistoryRow({ session, onOpen }: { session: Omit<SessionListItem, 'id' | 'startedAt' | 'endedAt'>; onOpen?: () => void }) {
  const weekday = weekdayOf(session.day);
  const body = (
    <>
      <span className={clsx('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl', DAY_BLOCKS[weekday])}>
        <span className="text-[10px] font-semibold uppercase leading-none">{WEEKDAYS[weekday]}</span>
        <span className="text-lg font-bold leading-tight tabular-nums">{Number(session.day.slice(8, 10))}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{session.plan ? session.plan.workoutName : 'Workout'}</span>
          {session.status === 'open' && (
            <span className="shrink-0 rounded-full bg-success-solid/15 px-2 py-0.5 text-[10px] font-semibold text-success">in progress</span>
          )}
        </span>
        {session.plan && <span className="block truncate text-xs text-ink-muted">{session.plan.planName}</span>}
        <span className="block truncate text-xs text-ink-faint">{session.exerciseNames.join(', ') || 'No exercises'}</span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums text-ink-muted">
        <span className="block font-semibold text-ink">{session.setCount} sets</span>
        {formatDuration(session.durationSeconds)}
      </span>
    </>
  );
  if (!onOpen) return <div className="card flex w-full items-center gap-3 p-3">{body}</div>;
  return (
    <button type="button" className="card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-accent/40" onClick={onOpen}>
      {body}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
    </button>
  );
}
