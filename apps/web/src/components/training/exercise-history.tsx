'use client';

import { useState } from 'react';
import { formatDay } from '@life-portal/shared-domain';
import type { ExerciseHistory as History } from '@life-portal/shared-types';
import { EmptyState, ErrorNote, Spinner } from '../ui';
import { useApi } from '../../lib/hooks';
import {
  RECORD_LABELS,
  bodyWeightNote,
  describeOneRepMax,
  formatRecordValue,
  formatWeight,
  useWeightUnit,
} from '../../lib/training';
import { SetLine } from './set-row';

/**
 * One exercise's progress: records first, then sessions newest first with each one's sets, best
 * set, volume and estimated 1RM. Every estimate shows its formula and the set it came from.
 */
export function ExerciseHistory({ exerciseId }: { exerciseId: string }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const first = useApi<History>(`/training/exercises/${exerciseId}/history`);
  const unit = useWeightUnit();
  if (first.error) return <ErrorNote message={(first.error as Error).message} />;
  if (!first.data) return <Spinner />;
  const { records, exercise } = first.data;
  if (!first.data.sessions.length) return <EmptyState message="Not done yet. Log it in a workout and it shows up here." />;
  return (
    <div className="space-y-4">
      {records.length > 0 && (
        <section>
          <h4 className="label">Personal records</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {records.map((record) => (
              <div key={record.kind} className="contents">
                <dt className="text-ink-faint">{RECORD_LABELS[record.kind]}</dt>
                <dd className="min-w-0">
                  <span className="font-medium tabular-nums">{formatRecordValue(record, unit)}</span>
                  <span className="ml-2 text-xs text-ink-faint">
                    {[formatDay(record.day), record.kind === 'best_1rm' ? 'Epley estimate' : '', bodyWeightNote(record.bodyWeightDay)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {cursors.map((cursor, index) => (
        <HistoryPage
          key={cursor ?? 'first'}
          exerciseId={exerciseId}
          cursor={cursor}
          measure={exercise.measure}
          isLast={index === cursors.length - 1}
          onMore={(next) => setCursors([...cursors, next])}
        />
      ))}
    </div>
  );
}

function HistoryPage({
  exerciseId,
  cursor,
  measure,
  isLast,
  onMore,
}: {
  exerciseId: string;
  cursor?: string;
  measure: History['exercise']['measure'];
  isLast: boolean;
  onMore: (cursor: string) => void;
}) {
  const unit = useWeightUnit();
  const { data, error } = useApi<History>(
    `/training/exercises/${exerciseId}/history${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`,
  );
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return <Spinner />;
  return (
    <>
      {data.sessions.map((session) => {
        const estimate = session.oneRepMax && describeOneRepMax(session.oneRepMax, unit);
        let working = 0;
        return (
          <section key={session.sessionId} className="rounded-xl border border-border p-3">
            <header className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-medium">{formatDay(session.day)}</span>
              {session.volumeGrams !== undefined && (
                <span className="text-xs text-ink-faint">Volume {formatWeight(session.volumeGrams, unit)}</span>
              )}
            </header>
            {session.sets.map((set) => (
              <SetLine
                key={set.id}
                index={set.type === 'warmup' ? 0 : ++working}
                set={set}
                measure={measure}
                best={set.id === session.bestSetId}
              />
            ))}
            {estimate && (
              <p className="mt-1 text-xs">
                <span className="font-medium">{estimate.value}</span>
                <span className="text-ink-faint"> · {estimate.basis}</span>
              </p>
            )}
          </section>
        );
      })}
      {isLast && data.nextCursor && (
        <button type="button" className="btn-ghost w-full justify-center" onClick={() => onMore(data.nextCursor as string)}>
          Older sessions
        </button>
      )}
    </>
  );
}
