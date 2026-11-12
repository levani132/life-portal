'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { SessionDetail, SessionListItem, SessionPage } from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import { ExerciseLibrary } from '../../components/training/exercise-library';
import { TrainingSettings } from '../../components/training/training-settings';
import { CurrentWorkout, WorkoutSession } from '../../components/training/workout-session';
import { EmptyState, ErrorNote, Panel, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { formatDuration, sessionKey } from '../../lib/training';

const TABS = [
  { id: 'workout', label: 'Workout' },
  { id: 'history', label: 'History' },
  { id: 'exercises', label: 'Exercises' },
] as const;
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
  return (
    <>
      <PageHeader title="Training" subtitle="Log workouts and look back at them." actions={<TrainingSettings />} />
      <div role="tablist" aria-label="Training" className="mb-4 flex gap-1 rounded-lg border border-border p-1" data-no-tab-swipe>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={clsx(
              'flex-1 rounded-md px-3 py-1.5 text-sm font-medium',
              tab === item.id ? 'bg-surface text-ink' : 'text-ink-faint hover:text-ink',
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'workout' && <CurrentWorkout />}
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
  const { data, error, isLoading } = useApi<SessionPage>('/training/sessions');

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

  if (!sessions.length) return <EmptyState message="No workouts yet. Start one on the Workout tab." />;
  return (
    <Panel>
      <ul className="divide-y divide-border">
        {sessions.map((session) => (
          <li key={session.id}>
            <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => setOpenId(session.id)}>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {formatDay(session.day)}
                  {session.status === 'open' && <span className="ml-2 text-xs text-emerald-400">in progress</span>}
                </span>
                <span className="block truncate text-xs text-ink-faint">
                  {session.exerciseNames.join(', ') || 'No exercises'}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs tabular-nums text-ink-faint">
                {session.setCount} sets
                <br />
                {formatDuration(session.durationSeconds)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {moreError && <ErrorNote message={moreError} />}
      {next && (
        <button type="button" className="btn-ghost mt-3 w-full" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? 'Loading…' : 'Older workouts'}
        </button>
      )}
    </Panel>
  );
}

function SessionView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, isLoading } = useApi<SessionDetail>(sessionKey(id));
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
