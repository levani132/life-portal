'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList, Dumbbell, History as HistoryIcon, Library, type LucideIcon } from 'lucide-react';
import type { SessionListItem, SessionPage } from '@life-portal/shared-types';
import { addDays, diffDays, formatDay, weekdayOf } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import { ExerciseLibrary } from '../../components/training/exercise-library';
import { Plans } from '../../components/training/plans';
import { TrainingHero } from '../../components/training/training-hero';
import { TrainingSettings } from '../../components/training/training-settings';
import { CurrentWorkout, WorkoutSession } from '../../components/training/workout-session';
import { ErrorNote, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDuration, useWorkoutDay } from '../../lib/training';
import { useHistoryPage, useSessionDetail } from '../../lib/training-offline';
import { OPEN_WORKOUT_EVENT, setWorkoutOnScreen } from '../../lib/training-workout';

const TABS: readonly { id: 'workout' | 'plans' | 'history' | 'exercises'; label: string; icon: LucideIcon }[] = [
  { id: 'workout', label: 'Workout', icon: Dumbbell },
  { id: 'plans', label: 'Plans', icon: ClipboardList },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'exercises', label: 'Exercises', icon: Library },
];
type Tab = (typeof TABS)[number]['id'];

export default function TrainingPage() {
  return (
    <AppShell>
      <Training />
    </AppShell>
  );
}

function Training() {
  const [tab, setTab] = useState<Tab>('workout');
  // Spec 025: the pinned workout bar hides while the workout itself is on screen, and its tap
  // brings this page back to the Workout tab.
  useEffect(() => {
    setWorkoutOnScreen(tab === 'workout');
    return () => setWorkoutOnScreen(false);
  }, [tab]);
  useEffect(() => {
    const open = () => {
      setTab('workout');
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(OPEN_WORKOUT_EVENT, open);
    return () => window.removeEventListener(OPEN_WORKOUT_EVENT, open);
  }, []);
  return (
    <>
      <PageHeader title="Training" actions={<TrainingSettings />} />
      <TrainingHero hideWhileTraining={tab === 'workout'} />
      <div
        role="tablist"
        aria-label="Training"
        className="mb-4 grid grid-cols-4 gap-1 rounded-2xl border border-border bg-surface-raised p-1 shadow-sm"
        data-no-tab-swipe
      >
        {TABS.map((item) => {
          const Icon = item.icon;
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={clsx(
                'flex min-h-[3rem] flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-xs font-semibold transition-colors',
                selected ? 'bg-accent-solid text-on-accent shadow' : 'text-ink-muted hover:bg-surface hover:text-ink',
              )}
              onClick={() => setTab(item.id)}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
      {tab === 'workout' && <CurrentWorkout onBrowsePlans={() => setTab('plans')} />}
      {tab === 'plans' && <Plans onStarted={() => setTab('workout')} />}
      {tab === 'history' && <History />}
      {tab === 'exercises' && <ExerciseLibrary />}
    </>
  );
}

/** Past sessions, newest day first, 20 at a time; one opens for reading and editing. */
function History() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [older, setOlder] = useState<SessionListItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // Spec 028: with workouts kept on this device (started or changed offline) applied.
  const { data, error, isLoading } = useHistoryPage();
  const today = useWorkoutDay()();

  if (openId) return <SessionView id={openId} onBack={() => setOpenId(null)} />;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const sessions = [...data.sessions, ...older.filter((s) => !data.sessions.some((d) => d.id === s.id))];
  const next = older.length ? cursor : data.nextCursor;
  const loadMore = async () => {
    if (!next) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.get<SessionPage>(`/training/sessions?cursor=${encodeURIComponent(next)}`);
      setOlder((current) => [...current, ...page.sessions]);
      setCursor(page.nextCursor);
    } catch (caught) {
      setMoreError((caught as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!sessions.length) {
    return (
      <div className="card flex flex-col items-center gap-2 p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-train-pull/10 text-train-pull">
          <HistoryIcon className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold">No workouts yet</p>
        <p className="text-xs text-ink-faint">Start one on the Workout tab and it shows up here.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {groupByWeek(sessions, today).map((week) => (
        <section key={week.start}>
          <header className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-sm font-bold">{week.label}</h2>
            <p className="shrink-0 text-xs tabular-nums text-ink-faint">
              {week.sessions.length} {week.sessions.length === 1 ? 'workout' : 'workouts'} · {week.sets} sets ·{' '}
              {formatDuration(week.seconds)}
            </p>
          </header>
          <ul className="space-y-2">
            {week.sessions.map((session) => (
              <li key={session.id}>
                <HistoryRow session={session} onOpen={() => setOpenId(session.id)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {moreError && <ErrorNote message={moreError} />}
      {next && (
        <button type="button" className="btn-ghost w-full" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? 'Loading…' : 'Older workouts'}
        </button>
      )}
    </div>
  );
}

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

function HistoryRow({ session, onOpen }: { session: SessionListItem; onOpen: () => void }) {
  const weekday = weekdayOf(session.day);
  return (
    <button
      type="button"
      className="card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-accent/40"
      onClick={onOpen}
    >
      <span className={clsx('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl', DAY_BLOCKS[weekday])}>
        <span className="text-[10px] font-semibold uppercase leading-none">{WEEKDAYS[weekday]}</span>
        <span className="text-lg font-bold leading-tight tabular-nums">{Number(session.day.slice(8, 10))}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {session.plan ? session.plan.workoutName : 'Workout'}
          </span>
          {session.status === 'open' && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
              in progress
            </span>
          )}
        </span>
        {session.plan && <span className="block truncate text-xs text-ink-muted">{session.plan.planName}</span>}
        <span className="block truncate text-xs text-ink-faint">{session.exerciseNames.join(', ') || 'No exercises'}</span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums text-ink-muted">
        <span className="block font-semibold text-ink">{session.setCount} sets</span>
        {formatDuration(session.durationSeconds)}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
    </button>
  );
}

interface Week {
  start: string;
  label: string;
  sessions: SessionListItem[];
  sets: number;
  seconds: number;
}

/** Monday-start weeks, newest first, with totals summed from the rows already loaded. */
function groupByWeek(sessions: SessionListItem[], today: string): Week[] {
  const monday = (day: string) => addDays(day, -((weekdayOf(day) + 6) % 7));
  const thisWeek = monday(today);
  const weeks = new Map<string, Week>();
  for (const session of sessions) {
    const start = monday(session.day);
    const ago = Math.round(diffDays(start, thisWeek) / 7);
    const week = weeks.get(start) ?? {
      start,
      label: ago <= 0 ? 'This week' : ago === 1 ? 'Last week' : `Week of ${formatDay(start)}`,
      sessions: [],
      sets: 0,
      seconds: 0,
    };
    week.sessions.push(session);
    week.sets += session.setCount;
    week.seconds += session.durationSeconds;
    weeks.set(start, week);
  }
  return [...weeks.values()].sort((a, b) => (a.start < b.start ? 1 : -1));
}

function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, isLoading } = useSessionDetail(id);
  return (
    <div className="space-y-3">
      <button type="button" className="btn-ghost" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" /> All workouts
      </button>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={(error as Error).message} />}
      {data && <WorkoutSession session={data} onGone={onBack} />}
    </div>
  );
}
