'use client';

import clsx from 'clsx';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { Check, CloudOff, Dumbbell, Layers, Medal, Repeat, Sparkles, Timer, Trophy, Weight } from 'lucide-react';
import type { SessionDetail, WorkoutRecap, WorkoutTotals } from '@life-portal/shared-types';
import { formatDay, rankLabel, workoutTotals } from '@life-portal/shared-domain';
import { Modal } from '../ui';
import { useApi } from '../../lib/hooks';
import { RECORD_LABELS, formatDuration, formatRecordValue, formatWeight, useTrainingProfile } from '../../lib/training';
import { hasUnsyncedWrites, useTrainingSync, useTrainingWrites } from '../../lib/training-offline';
import { PlanDayUpdate } from './plan-day-update';
import { RankEmblem } from './rank-emblem';

export const recapKey = (sessionId: string) => `/training/sessions/${sessionId}/recap`;

/** How long after finishing a confirmed achievement may still animate in. */
const CELEBRATE_WITHIN_MS = 8000;

/**
 * Issue #25: the recap of a finished workout. Right after finishing (`celebrate`) it animates in;
 * from History it is the same recap, still. Only what the server confirms is celebrated: records
 * are the marks on the sets, rank-ups and the level come from their engines (`GET …/recap`). While
 * the workout is still on this device, its numbers are shown with a pending note, and anything
 * earned appears later, in History, without a delayed animation.
 */
export function WorkoutRecapView({
  session,
  celebrate = false,
  onClose,
}: {
  /** The workout as this device has it, for the numbers while the server's recap is not there. */
  session: SessionDetail;
  celebrate?: boolean;
  onClose: () => void;
}) {
  const profile = useTrainingProfile();
  const writes = useTrainingWrites();
  const sync = useTrainingSync();
  const pending = hasUnsyncedWrites(writes, session.id);
  const { data: recap, error, isLoading } = useApi<WorkoutRecap>(pending ? null : recapKey(session.id), { revalidateOnMount: true });
  // Achievements animate only when the server's answer comes while the recap is still fresh: a
  // workout finished offline, or one that took long to sync, shows them still (never a delayed
  // "level up" out of nowhere).
  const opened = useRef(Date.now());
  const offlineAtOpen = useRef(sync.offline);
  const decided = useRef<boolean | null>(null);
  if (recap && decided.current === null) {
    decided.current = celebrate && !offlineAtOpen.current && Date.now() - opened.current < CELEBRATE_WITHIN_MS;
  }
  const totals: WorkoutTotals = recap?.totals ?? workoutTotals(session);
  const unit = profile.weightUnit;
  let step = 0;
  const stagger = (on: boolean, className = 'recap-in'): { className?: string; style?: CSSProperties } =>
    on ? { className, style: { animationDelay: `${120 + step++ * 90}ms` } } : {};
  /** The workout's own numbers: true from the start, so they may animate at once. */
  const enter = () => stagger(celebrate);
  /** What was earned: only when confirmed in time (see above). */
  const earned = () => stagger(decided.current === true);

  return (
    <Modal open onClose={onClose} title={celebrate ? 'Workout complete' : `Workout · ${formatDay(session.day)}`}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30',
              celebrate && 'recap-pop',
            )}
            aria-hidden
          >
            <Check className="h-6 w-6" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{celebrate ? 'Workout complete' : 'Workout recap'}</p>
            <p className="truncate text-sm text-ink-faint">
              {session.plan ? `${session.plan.workoutName} · ${session.plan.planName}` : formatDay(session.day)}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2" {...enter()}>
          <Stat icon={Timer} label="Time" value={formatDuration(totals.durationSeconds)} />
          <Stat icon={Weight} label="Volume" value={totals.volumeGrams ? formatWeight(totals.volumeGrams, unit) : '—'} />
          <Stat icon={Layers} label="Sets" value={String(totals.workingSets)} />
          <Stat icon={Repeat} label="Reps" value={String(totals.reps)} />
          <Stat icon={Dumbbell} label="Exercises" value={String(totals.exercises)} />
        </dl>

        {pending && !sync.offline ? (
          <p className="flex items-center gap-2 text-xs text-ink-faint" role="status">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-sky-500 motion-reduce:animate-none" aria-hidden />
            Saving to your account…
          </p>
        ) : pending ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300" role="status">
            <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Saved on this device and waiting to sync. Records, ranks and your level appear here and in History once it reaches
            the server.
          </p>
        ) : isLoading ? (
          <p className="flex items-center gap-2 text-xs text-ink-faint" role="status">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-sky-500 motion-reduce:animate-none" aria-hidden />
            Loading records and ranks…
          </p>
        ) : error || !recap ? (
          <p className="text-xs text-ink-faint">Records and ranks could not be loaded. They are in History.</p>
        ) : (
          <Achievements recap={recap} unit={unit} enter={earned} />
        )}

        {totals.setsByMuscle.length > 0 && (
          <section {...enter()} aria-label="Sets by muscle">
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">Sets by muscle</h4>
            <ul className="space-y-1">
              {totals.setsByMuscle.slice(0, 6).map((row) => (
                <li key={row.muscle} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate capitalize">{row.muscle.replace(/_/g, ' ')}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface">
                    <span
                      className="block h-full rounded-full bg-train-pull-solid"
                      style={{ width: `${Math.round((row.sets / totals.setsByMuscle[0].sets) * 100)}%` }}
                    />
                  </span>
                  <span className="w-6 text-right tabular-nums text-ink-faint">{row.sets}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!celebrate && recap && (
          <p className="text-[11px] text-ink-faint">
            Worked out again now, as of this workout: ranks use the standards that applied on {formatDay(session.day)}, with your
            current weigh-ins and rank settings. Correcting a set or a weigh-in can change them.
          </p>
        )}

        {/* Issue #15, after the recap and never over it. */}
        {celebrate && session.plan && !pending && <PlanDayUpdate sessionId={session.id} />}

        <button type="button" className="btn-primary w-full justify-center" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

function Achievements({
  recap,
  unit,
  enter,
}: {
  recap: WorkoutRecap;
  unit: ReturnType<typeof useTrainingProfile>['weightUnit'];
  enter: (className?: string) => { className?: string; style?: CSSProperties };
}) {
  const rankUps = recap.rankUps ?? [];
  const levelUp = recap.level && recap.level.to > recap.level.from;
  return (
    <div className="space-y-2">
      {rankUps.map((up) => (
        <Highlight key={up.exerciseId} {...enter()} tone="rank">
          <RankEmblem tier={up.to.tier} division={up.to.division} size={36} label={rankLabel(up.to)} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Rank up · {up.name}</p>
            <p className="font-bold capitalize">
              {up.from ? `${rankLabel(up.from)} → ${rankLabel(up.to)}` : `First rank: ${rankLabel(up.to)}`}
            </p>
            <p className="text-[11px] text-ink-faint">Strength rank on this exercise</p>
          </div>
        </Highlight>
      ))}

      {recap.level && (
        <Highlight {...enter()} tone={levelUp ? 'level' : 'quiet'}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden>
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {levelUp ? 'You levelled up' : 'Training level'}
            </p>
            <p className="font-bold">
              {levelUp ? `Level ${recap.level.from} → ${recap.level.to}` : `Level ${recap.level.to}`}
              {recap.level.xpGained > 0 && <span className="ml-2 text-sm font-medium text-ink-faint">+{recap.level.xpGained} XP</span>}
            </p>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface"
              role="progressbar"
              aria-label="XP to the next level"
              aria-valuemin={0}
              aria-valuemax={recap.level.after.xpForLevel}
              aria-valuenow={recap.level.after.xpIntoLevel}
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round((recap.level.after.xpIntoLevel / Math.max(1, recap.level.after.xpForLevel)) * 100)}%` }}
              />
            </div>
            <p className="mt-0.5 text-[11px] text-ink-faint">Overall training, all exercises</p>
          </div>
        </Highlight>
      )}

      {recap.records.length > 0 && (
        <Highlight {...enter()} tone="record">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-500" aria-hidden>
            <Trophy className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {recap.records.length === 1 ? 'Personal record' : `${recap.records.length} personal records`}
            </p>
            <ul className="mt-0.5 space-y-0.5 text-sm">
              {recap.records.map((record) => (
                <li key={`${record.setId}:${record.kind}`} className="flex flex-wrap gap-x-1">
                  <span className="font-medium">{record.name}</span>
                  <span className="text-ink-faint">
                    · {RECORD_LABELS[record.kind]}
                    {record.entry ? ` ${formatRecordValue(record.entry, unit)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Highlight>
      )}

      {!recap.achievements && (
        <p className="flex items-center gap-2 text-sm text-ink-muted" {...enter()}>
          <Medal className="h-4 w-4 text-ink-faint" aria-hidden /> Done and logged. Every session counts.
        </p>
      )}
    </div>
  );
}

function Highlight({
  children,
  tone,
  className,
  style,
}: {
  children: ReactNode;
  tone: 'rank' | 'level' | 'record' | 'quiet';
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-xl border p-3',
        tone === 'rank' && 'border-train-pull/40 bg-train-pull/10',
        tone === 'level' && 'border-accent/40 bg-accent/10',
        tone === 'record' && 'border-amber-500/40 bg-amber-500/10',
        tone === 'quiet' && 'border-border',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Timer; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-2.5 py-2">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-faint">
        <Icon className="h-3 w-3" aria-hidden /> {label}
      </dt>
      <dd className="text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}
