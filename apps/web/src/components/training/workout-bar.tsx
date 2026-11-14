'use client';

import clsx from 'clsx';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Dumbbell, Timer } from 'lucide-react';
import type { SessionDetail } from '@life-portal/shared-types';
import { api } from '../../lib/api';
import { formatDuration, useTrainingProfile } from '../../lib/training';
import { useCurrentSession } from '../../lib/training-offline';
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
export function WorkoutBar({ enabled, push = false }: { enabled: boolean; push?: boolean }) {
  // Spec 028: the open workout as this device sees it, including one started offline.
  const { data } = useCurrentSession(enabled);
  const onScreen = useWorkoutOnScreen();
  const open = data?.status === 'open' ? data : undefined;
  if (!enabled || !open) return null;
  return (
    <>
      {push && <RestAlarmSync session={open} />}
      {!onScreen && <Bar session={open} />}
    </>
  );
}

/**
 * Spec 025: keeps the server's rest alarm in step with the rest shown here, so a push says "Rest
 * over" when it ends, even with the phone locked. Sent after each set, ±15 s and Skip; a rest
 * of 0 (mid-superset) or a skipped one cancels it. Renders nothing. Mounted with the header, so
 * it works on every page, not only on Training.
 */
function RestAlarmSync({ session }: { session: SessionDetail }) {
  const profile = useTrainingProfile();
  const focus = sessionFocus(session, [], profile.defaultRestSeconds);
  const controls = useRestControls(session.lastSetAt);
  const total = focus.restSeconds + controls.addSeconds;
  const due = session.lastSetAt && !controls.skipped && total > 0 ? Date.parse(session.lastSetAt) + total * 1000 : null;
  const sent = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    // Nothing set from here yet and nothing to set: no request on every page load.
    if (due === sent.current || (due === null && sent.current === undefined)) return;
    if (due !== null && due <= Date.now()) return;
    sent.current = due;
    api
      .put(`/training/sessions/${session.id}/rest-alarm`, { at: due === null ? null : new Date(due).toISOString() })
      .catch(() => {
        // The in-app timer still works; try again on the next change.
        sent.current = undefined;
      });
  }, [due, session.id]);
  return null;
}

function Bar({ session }: { session: SessionDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const profile = useTrainingProfile();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const focus = sessionFocus(session, [], profile.defaultRestSeconds);
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
