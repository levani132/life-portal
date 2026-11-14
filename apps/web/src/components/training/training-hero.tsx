'use client';

import { useState } from 'react';
import { Clock, Flame, Star, Trophy, Zap } from 'lucide-react';
import type { PortalState, TrainingLevel, TrainingSummary } from '@life-portal/shared-types';
import { formatRecordValue } from '@life-portal/shared-domain';
import { useApi } from '../../lib/hooks';
import { useWorkoutDay } from '../../lib/training';
import { Modal } from '../ui';
import { RankJourney } from './rank-journey';

/** `1:05` for an hour and five minutes, `25m` under an hour. Display only. */
function shortTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function lastLabel(days: number | undefined): string {
  if (days === undefined) return '—';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

/**
 * The top of Training (spec 024): this week at a glance on a gradient, from the same summary the
 * Home card reads. Nothing here is a control; it only shows where the week stands. Hidden on the
 * Workout tab while a workout is open, where that workout's header carries the same news.
 */
export function TrainingHero({ hideWhileTraining = false }: { hideWhileTraining?: boolean }) {
  const today = useWorkoutDay()();
  const { data } = useApi<TrainingSummary>(`/training/summary?today=${today}`);
  const portal = useApi<PortalState>('/portal');
  const [ranks, setRanks] = useState(false);
  // On the Workout tab the open workout's own header says all of this; keep it near the top.
  if (hideWhileTraining && data?.openSessionId) return null;
  const workouts = data?.workoutsThisWeek ?? 0;
  const line = !data
    ? 'Loading your week…'
    : data.openSessionId
      ? 'Workout in progress. Keep going.'
      : data.latestRecord
        ? `New record: ${data.latestRecord.exerciseName}, ${formatRecordValue(data.latestRecord, data.weightUnit)}`
        : workouts === 0
          ? 'A fresh week. Time to get moving.'
          : workouts === 1
            ? 'One workout down this week. Nice start.'
            : `${workouts} workouts down this week. Nice work.`;

  return (
    <>
    <section className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-train-pull-solid via-train-arms-solid to-train-cardio-solid p-4 text-white shadow-lg shadow-train-arms-solid/20 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-16 right-16 h-32 w-32 rounded-full bg-white/10" />
      <div className="relative">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/80">
          {data?.openSessionId ? <Zap className="h-3.5 w-3.5" /> : <Flame className="h-3.5 w-3.5" />}
          This week
        </p>
        <p className="mt-1 truncate text-base font-semibold sm:text-lg">{line}</p>
        <dl className="mt-4 grid grid-cols-3 gap-2">
          <Stat icon={<Flame className="h-4 w-4" />} value={String(workouts)} label={workouts === 1 ? 'workout' : 'workouts'} />
          <Stat icon={<Clock className="h-4 w-4" />} value={shortTime(data?.secondsThisWeek ?? 0)} label="time" />
          {data?.latestRecord ? (
            <Stat icon={<Trophy className="h-4 w-4" />} value="PR" label="new record" />
          ) : (
            <Stat icon={<Zap className="h-4 w-4" />} value={data?.openSessionId ? 'Now' : lastLabel(data?.daysSinceLast)} label="last workout" />
          )}
        </dl>
        <LevelBar today={today} onRanks={portal.data?.access.trainingRanks ? () => setRanks(true) : undefined} />
      </div>
    </section>
    {/* Outside the hero: its backdrop blur would trap a fixed modal, and its white text would leak in. */}
    <Modal open={ranks} onClose={() => setRanks(false)} title="Strength ranks" wide>
      <RankJourney tournaments={!!portal.data?.access.tournaments} />
    </Modal>
    </>
  );
}

/**
 * The uncapped training level (issue #5a), with the `trainingLevels` flag: a measure of how much
 * you have trained, not how strong you are, so it never sits next to a strength figure. Hidden
 * until it loads, and when the flag is off.
 */
function LevelBar({ today, onRanks }: { today: string; onRanks?: () => void }) {
  const portal = useApi<PortalState>('/portal');
  const enabled = !!portal.data?.access.trainingLevels;
  const { data } = useApi<TrainingLevel>(enabled ? `/training/level?today=${today}` : null);
  if (!enabled || !data) return null;
  const toNext = data.xpForLevel - data.xpIntoLevel;
  return (
    <div className="mt-3 rounded-xl bg-white/15 px-3 py-2 backdrop-blur-sm">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex items-center gap-1.5 font-bold">
          <Star className="h-4 w-4 text-white/80" aria-hidden /> Level {data.level}
        </span>
        <span className="truncate text-[11px] tabular-nums text-white/80">
          {toNext} XP to level {data.level + 1}
        </span>
      </div>
      {onRanks && (
        <button type="button" className="mt-1 text-[11px] font-semibold text-white underline underline-offset-2" onClick={onRanks}>
          All strength ranks
        </button>
      )}
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/25"
        role="progressbar"
        aria-label={`Training level ${data.level}: ${data.xpIntoLevel} of ${data.xpForLevel} XP`}
        aria-valuemin={0}
        aria-valuemax={data.xpForLevel}
        aria-valuenow={data.xpIntoLevel}
      >
        <div
          className="h-full rounded-full bg-white transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${Math.round((data.xpIntoLevel / data.xpForLevel) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white/15 px-3 py-2 backdrop-blur-sm">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="flex items-center gap-1 text-white/80">{icon}</span>
        <span className="mt-1 block truncate text-xl font-bold tabular-nums leading-tight">{value}</span>
        <span className="block truncate text-[11px] text-white/80">{label}</span>
      </dd>
    </div>
  );
}
