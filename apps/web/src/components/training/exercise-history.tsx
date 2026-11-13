'use client';

import clsx from 'clsx';
import { type ReactNode, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDay, gramsToDisplay, lowerIsBetter } from '@life-portal/shared-domain';
import type {
  ExerciseHistory as History,
  ExerciseProgressView,
  NextRecord,
  ProgressMetric,
  ProgressRange,
  ProgressTrend,
  RecordEntry,
  RecordKind,
  WeightUnit,
} from '@life-portal/shared-types';
import { EmptyState, ErrorNote, EstimateMark, Spinner } from '../ui';
import { useApi } from '../../lib/hooks';
import {
  RECORD_LABELS,
  bodyWeightNote,
  describeOneRepMax,
  formatDistance,
  formatDuration,
  formatPace,
  formatRecordValue,
  formatWeight,
  useWeightUnit,
  useWorkoutDay,
} from '../../lib/training';
import { SetLine } from './set-row';
import { StrengthRank, TrainingLevelLink } from './strength-rank';
import { TournamentPanel } from './tournaments';

/**
 * One exercise's statistics (issue #6), shared by the workout and the library: key figures, a
 * per-session progress chart over a range, the 4-week trend, the next record to aim for, records,
 * then every session newest first. Every figure is derived on read; estimates say they are.
 */

export const METRIC_LABELS: Record<ProgressMetric, string> = {
  one_rep_max: 'Est. 1RM',
  heaviest: 'Heaviest',
  reps: 'Most reps',
  duration: 'Longest',
  distance: 'Distance',
  pace: 'Pace',
  volume: 'Volume',
};

const RANGE_LABELS: Record<ProgressRange, string> = { '3m': '3M', '1y': '1Y', all: 'All' };

const RECORD_FOR: Partial<Record<ProgressMetric, RecordKind>> = {
  one_rep_max: 'best_1rm',
  reps: 'most_reps',
  duration: 'longest_duration',
  distance: 'longest_distance',
};

const WEIGHT_METRICS = new Set<ProgressMetric>(['one_rep_max', 'heaviest', 'volume']);

export function formatMetric(metric: ProgressMetric, value: number, unit: WeightUnit): string {
  if (WEIGHT_METRICS.has(metric)) return formatWeight(value, unit);
  if (metric === 'reps') return `${value} ${value === 1 ? 'rep' : 'reps'}`;
  if (metric === 'distance') return formatDistance(value);
  if (metric === 'pace') return formatPace(value);
  return formatDuration(value);
}

/** The chart's y value: weights in the display unit, so ticks read as kg or lb. */
const chartValue = (metric: ProgressMetric, value: number, unit: WeightUnit) =>
  WEIGHT_METRICS.has(metric) ? gramsToDisplay(value, unit) : value;

/** One part of the history, for a tab of the exercise's details. Without it, everything. */
export type HistorySection = 'progress' | 'rank' | 'sessions';

export function ExerciseHistory({ exerciseId, section }: { exerciseId: string; section?: HistorySection }) {
  const [range, setRange] = useState<ProgressRange>('3m');
  const workoutDay = useWorkoutDay();
  const today = workoutDay();
  const unit = useWeightUnit();
  const progress = useApi<ExerciseProgressView>(
    `/training/exercises/${exerciseId}/progress?range=${range}&today=${today}`,
    { keepPreviousData: true },
  );
  const show = (part: HistorySection) => !section || section === part;
  // The rank says what it needs by itself (a weigh-in, a working set), sessions or not.
  const rank = (
    <>
      <StrengthRank exerciseId={exerciseId} today={today} />
      <TournamentPanel exerciseId={exerciseId} today={today} />
    </>
  );
  if (section === 'rank') {
    return (
      <div className="space-y-4">
        {rank}
        <TrainingLevelLink today={today} />
      </div>
    );
  }
  if (progress.error) return <ErrorNote message={(progress.error as Error).message} />;
  if (!progress.data) return <Spinner />;
  const view = progress.data;
  const earlier = view.earlierMeasureSets ? <EarlierSetsNote count={view.earlierMeasureSets} /> : null;
  if (!view.totalSessions) {
    return (
      <div className="space-y-3">
        <EmptyState message="Not done yet. Log it in a workout and it shows up here." />
        {earlier}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {earlier}
      {show('progress') && <KeyFigures view={view} unit={unit} />}
      {!section && rank}
      {show('progress') && (
        <>
          <ProgressChart view={view} unit={unit} range={range} onRange={setRange} loading={progress.isValidating} />
          {view.nextRecord && <NextRecordCard next={view.nextRecord} unit={unit} />}
          {view.records.length > 0 && <Records records={view.records} unit={unit} />}
        </>
      )}
      {show('sessions') && <Sessions exerciseId={exerciseId} measure={view.exercise.measure} />}
      {!section && <TrainingLevelLink today={today} />}
    </div>
  );
}

/**
 * Sets logged under an older measure (#5: weighted pull-ups and dips used to be weight only)
 * are kept exactly as logged; they are left out of these figures rather than reinterpreted.
 */
function EarlierSetsNote({ count }: { count: number }) {
  return (
    <p className="rounded-xl border border-border p-3 text-xs text-ink-faint">
      {count === 1 ? '1 earlier set was' : `${count} earlier sets were`} logged as weight only, before this exercise
      counted your body weight. They stay in their workouts as logged and are not counted here.
    </p>
  );
}

function KeyFigures({ view, unit }: { view: ExerciseProgressView; unit: WeightUnit }) {
  const primary = view.metrics[0];
  const kind = RECORD_FOR[primary];
  const best = kind && view.records.find((record) => record.kind === kind);
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Figure label={best ? RECORD_LABELS[best.kind] : 'Best'}>
        {best ? formatRecordValue(best, unit) : '—'}
        {best?.kind === 'best_1rm' && <EstimateMark basis="Epley estimate from your best set of 1–12 reps." />}
      </Figure>
      <Figure label="Sessions">{view.totalSessions}</Figure>
      <Figure label="Last done">{view.lastDay ? formatDay(view.lastDay) : '—'}</Figure>
      <Figure label="Last 4 weeks">
        {view.trend ? <TrendText trend={view.trend} unit={unit} /> : <span className="text-ink-faint">—</span>}
      </Figure>
    </dl>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

/** The change in the best of the last 28 days against the 28 before, in the metric's own units. */
export function TrendText({ trend, unit }: { trend: ProgressTrend; unit: WeightUnit }) {
  const change = trend.current - trend.previous;
  const better = lowerIsBetter(trend.metric) ? change < 0 : change > 0;
  if (change === 0) return <span title="Same best as the 4 weeks before">Level</span>;
  return (
    <span title={`Best ${formatMetric(trend.metric, trend.current, unit)} vs ${formatMetric(trend.metric, trend.previous, unit)} the 4 weeks before`}>
      <span aria-hidden>{better ? '▲' : '▼'} </span>
      <span className="sr-only">{better ? 'Up' : 'Down'} </span>
      {formatMetric(trend.metric, Math.abs(change), unit)}
    </span>
  );
}

function ProgressChart({
  view,
  unit,
  range,
  onRange,
  loading,
}: {
  view: ExerciseProgressView;
  unit: WeightUnit;
  range: ProgressRange;
  onRange: (range: ProgressRange) => void;
  loading: boolean;
}) {
  const [chosen, setChosen] = useState<ProgressMetric | undefined>();
  const metric = chosen && view.metrics.includes(chosen) ? chosen : view.metrics[0];
  const data = useMemo(
    () =>
      view.points.flatMap((point) => {
        const value = point.values[metric];
        return value === undefined ? [] : [{ day: point.day, value: chartValue(metric, value, unit), raw: value }];
      }),
    [view.points, metric, unit],
  );
  return (
    <section aria-label="Progress" className="rounded-xl border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {view.metrics.length > 1 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Measure">
            {view.metrics.map((item) => (
              <Pill key={item} selected={item === metric} onClick={() => setChosen(item)}>
                {METRIC_LABELS[item]}
              </Pill>
            ))}
          </div>
        ) : (
          <h4 className="text-sm font-semibold">{METRIC_LABELS[metric]}</h4>
        )}
        <div className="flex gap-1" role="group" aria-label="Range">
          {(Object.keys(RANGE_LABELS) as ProgressRange[]).map((item) => (
            <Pill key={item} selected={item === range} onClick={() => onRange(item)}>
              {RANGE_LABELS[item]}
            </Pill>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-faint">No sessions in this range.</p>
      ) : (
        <div className={clsx('h-48 transition-opacity', loading && 'opacity-60')} data-no-tab-swipe>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgb(var(--border))" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: 'rgb(var(--ink-faint))', fontSize: 11 }}
                tickFormatter={(value: string) => formatDay(value)}
                stroke="rgb(var(--border))"
                minTickGap={36}
              />
              <YAxis
                tick={{ fill: 'rgb(var(--ink-faint))', fontSize: 11 }}
                stroke="rgb(var(--border))"
                domain={['auto', 'auto']}
                // Pace: lower is better, so the axis is flipped and up still means faster.
                reversed={lowerIsBetter(metric)}
                tickFormatter={(value: number) =>
                  metric === 'duration' || metric === 'pace' ? formatDuration(Math.round(value)) : `${Math.round(value * 10) / 10}`
                }
                width={48}
              />
              <Tooltip
                cursor={{ stroke: 'rgb(var(--ink-faint))', strokeDasharray: '3 3' }}
                contentStyle={{
                  background: 'rgb(var(--surface-raised))',
                  border: '1px solid rgb(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(label) => (typeof label === 'string' ? formatDay(label) : '')}
                formatter={(_value, _name, item) =>
                  [formatMetric(metric, (item.payload as { raw: number }).raw, unit), METRIC_LABELS[metric]] as [string, string]
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="rgb(var(--train-pull))"
                strokeWidth={2}
                dot={data.length <= 40 ? { r: 3, fill: 'rgb(var(--train-pull))', strokeWidth: 0 } : false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-1 text-xs text-ink-faint">
        {data.length === 1 ? 'One session in this range. Two make a line.' : `${view.sessionsInRange} sessions, the best of each`}
        {view.points.length < view.sessionsInRange && ` · showing ${view.points.length}`}
        {metric === 'one_rep_max' && ' · Epley estimates'}
        {metric === 'pace' && ' · faster is higher'}
      </p>
    </section>
  );
}

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={clsx(
        'shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
        selected ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function NextRecordCard({ next, unit }: { next: NextRecord; unit: WeightUnit }) {
  const value = (amount: number) =>
    next.kind === 'best_1rm' ? formatWeight(amount, unit) : formatRecordValue({ kind: next.kind, value: amount } as RecordEntry, unit);
  return (
    <section aria-label="Next record" className="rounded-xl border border-border p-3 text-sm">
      <p className="text-xs text-ink-faint">Next record · {RECORD_LABELS[next.kind]}</p>
      <p className="mt-0.5">
        <span className="font-semibold tabular-nums">{value(next.target)}</span>
        <span className="text-ink-faint"> (now {value(next.current)})</span>
      </p>
      {next.suggestion && (
        <p className="mt-1 text-ink-muted">
          For example {formatWeight(next.suggestion.loadGrams, unit)} × {next.suggestion.reps}
          <EstimateMark basis="The fewest reps at your last working weight (or the next plate step up) whose Epley estimate beats your best. An estimate, not a prescription." />
        </p>
      )}
    </section>
  );
}

function Records({ records, unit }: { records: RecordEntry[]; unit: WeightUnit }) {
  return (
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
  );
}

function Sessions({ exerciseId, measure }: { exerciseId: string; measure: History['exercise']['measure'] }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  return (
    <section className="space-y-3">
      <h4 className="label">Sessions</h4>
      {cursors.map((cursor, index) => (
        <HistoryPage
          key={cursor ?? 'first'}
          exerciseId={exerciseId}
          cursor={cursor}
          measure={measure}
          isLast={index === cursors.length - 1}
          onMore={(next) => setCursors([...cursors, next])}
        />
      ))}
    </section>
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
