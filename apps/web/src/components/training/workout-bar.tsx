'use client';

import clsx from 'clsx';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Dumbbell, Timer } from 'lucide-react';
import type { SessionDetail } from '@life-portal/shared-types';
import { useApi } from '../../lib/hooks';
import { CURRENT_KEY, formatDuration, useTrainingProfile } from '../../lib/training';
import { useTrainingQueue } from '../../lib/training-queue';
import {
  OPEN_WORKOUT_EVENT,
  restLeft,
  sessionFocus,
  useRestControls,
  useWorkoutOnScreen,
} from '../../lib/training-workout';

/**
 * Spec 025: a slim bar under the app header while a workout is open, on every page: how long it
 * has been going, the current exercise, and the rest countdown while one runs. Tapping it opens
 * the workout. It hides while the workout itself is on screen (the Training page's Workout tab),
 * which already shows all of this.
 *
 * It lives inside the header, so `--header-offset` includes it and the rest timer still sticks
 * right under it. Display only: everything is derived from the open session.
 */
export function WorkoutBar({ enabled }: { enabled: boolean }) {
  const { data } = useApi<SessionDetail | undefined>(enabled ? CURRENT_KEY : null, {
    // A workout started on another device shows up when this one comes back to the app.
    revalidateOnFocus: true,
  });
  const onScreen = useWorkoutOnScreen();
  const open = data?.status === 'open' ? data : undefined;
  if (!enabled || !open || onScreen) return null;
  return <Bar session={open} />;
}

function Bar({ session }: { session: SessionDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const profile = useTrainingProfile();
  const queue = useTrainingQueue();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const pending = useMemo(
    () =>
      queue.jobs
        .map((job) => job.meta as { sessionId: string; workoutExerciseId: string })
        .filter((meta) => meta.sessionId === session.id),
    [queue.jobs, session.id],
  );
  const focus = sessionFocus(session, pending, profile.defaultRestSeconds);
  const controls = useRestControls(session.lastSetAt);
  const left = restLeft(session.lastSetAt, focus.restSeconds, controls, now);
  const resting = left !== undefined && left > 0;
  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000));

  const openWorkout = () => {
    if (pathname === '/training') window.dispatchEvent(new Event(OPEN_WORKOUT_EVENT));
    else router.push('/training');
  };

  return (
    <div className="mx-auto max-w-7xl px-3 pb-2">
      <button
        type="button"
        onClick={openWorkout}
        className="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-r from-train-legs-solid to-train-pull-solid px-3 py-2 text-left text-white shadow-sm transition-opacity active:opacity-90"
        aria-label={`Workout in progress, ${formatDuration(elapsed)}. Open it`}
      >
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Dumbbell className="h-4 w-4" aria-hidden />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-train-legs-solid motion-safe:animate-pulse" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {session.isStale ? 'Unfinished workout' : (focus.current?.snapshot.name ?? 'Ready to finish')}
          </span>
          <span className="block truncate text-[11px] text-white/80">
            {[session.plan?.workoutName ?? 'Workout in progress', focus.current ? '' : 'every exercise done']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end tabular-nums">
          <span className={clsx('flex items-center gap-1 text-sm font-bold', resting && 'text-white/70')}>
            {!session.isStale && formatDuration(elapsed)}
          </span>
          {resting && (
            <span className="flex items-center gap-1 rounded-full bg-white/25 px-1.5 text-[11px] font-semibold">
              <Timer className="h-3 w-3" aria-hidden /> {formatDuration(left)}
            </span>
          )}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/80" aria-hidden />
      </button>
    </div>
  );
}
