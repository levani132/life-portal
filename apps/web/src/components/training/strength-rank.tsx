'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import type {
  ExerciseRankView,
  PortalState,
  RankBenchmark,
  RankPosition,
  RankStandards,
  RankTier,
  TrainingLevel,
  TrainingProfile,
  WeightUnit,
} from '@life-portal/shared-types';
import { formatDay, rankLabel } from '@life-portal/shared-domain';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { PROFILE_KEY, formatWeight } from '../../lib/training';
import { ErrorNote } from '../ui';

/**
 * Strength rank for one exercise (issue #5b) inside its statistics view (#6): the current rank
 * (best valid set in 90 days), the highest ever, progress to the next division and exactly what
 * the score was worked out from. Personal: compared with fixed published standards, never with
 * other members. Only with `trainingRanks`.
 */

const TIER_STYLE: Record<RankTier, string> = {
  Initiate: 'from-slate-400 to-slate-600',
  Explorer: 'from-emerald-400 to-emerald-700',
  Challenger: 'from-sky-400 to-sky-700',
  Achiever: 'from-indigo-400 to-indigo-700',
  Veteran: 'from-violet-400 to-violet-700',
  Elite: 'from-amber-300 to-amber-600',
  Master: 'from-rose-400 to-rose-700',
  Legend: 'from-yellow-200 via-amber-400 to-orange-600',
};

/** "1.25× body weight" or "25 reps". */
export function formatRankScore(score: number, benchmark: Pick<RankBenchmark, 'method'>) {
  return benchmark.method === 'reps' ? `${score} ${score === 1 ? 'rep' : 'reps'}` : `${(score / 1000).toFixed(2)}× body weight`;
}

/** A hexagon in the tier's colours with one to three pips for III, II, I. The label is always text too. */
export function RankBadge({ position, size = 'md', muted = false }: { position: Pick<RankPosition, 'tier' | 'division' | 'milestone'>; size?: 'sm' | 'md'; muted?: boolean }) {
  const pips = (position.milestone % 3) + 1;
  return (
    <span
      aria-hidden
      className={clsx(
        'relative inline-flex shrink-0 items-center justify-center bg-gradient-to-br text-white',
        TIER_STYLE[position.tier],
        size === 'md' ? 'h-12 w-11' : 'h-8 w-7',
        muted && 'opacity-50 grayscale',
      )}
      style={{ clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)' }}
    >
      <span className={clsx('font-bold', size === 'md' ? 'text-sm' : 'text-[10px]')}>{position.tier[0]}</span>
      <span className="absolute bottom-[18%] flex gap-0.5">
        {Array.from({ length: pips }, (_, i) => (
          <span key={i} className={clsx('rounded-full bg-white', size === 'md' ? 'h-1 w-1' : 'h-0.5 w-0.5')} />
        ))}
      </span>
    </span>
  );
}

export function StrengthRank({ exerciseId, today }: { exerciseId: string; today: string }) {
  const portal = useApi<PortalState>('/portal');
  const enabled = !!portal.data?.access.trainingRanks;
  const rank = useApi<ExerciseRankView>(enabled ? `/training/exercises/${exerciseId}/rank?today=${today}` : null);
  const profile = useApi<TrainingProfile>(enabled ? PROFILE_KEY : null);
  const unit: WeightUnit = profile.data?.weightUnit ?? 'kg';
  if (!enabled || !rank.data) return rank.error ? <ErrorNote message={(rank.error as Error).message} /> : null;
  const view = rank.data;
  if (view.reason === 'no_benchmark') {
    return (
      <p className="text-xs text-ink-faint">
        No strength rank for this exercise: ranks cover a few standard free-weight and bodyweight lifts.
      </p>
    );
  }
  return (
    <section aria-label="Strength rank" className="rounded-xl border border-border p-3 text-sm">
      <h4 className="label">Strength rank</h4>
      {view.reason === 'needs_standards' ? (
        <ChooseStandards onChosen={() => void rank.mutate()} />
      ) : view.reason === 'needs_body_weight' ? (
        <p className="text-ink-muted">Log a weigh-in to rank this lift: scores are scaled to body weight, from a weigh-in within 90 days before the set.</p>
      ) : view.reason === 'no_valid_sets' ? (
        <p className="text-ink-muted">Log a working set of 1–12 reps to get a rank.</p>
      ) : (
        <Ranked view={view} unit={unit} onChangeStandards={() => void rank.mutate()} />
      )}
    </section>
  );
}

function Ranked({ view, unit, onChangeStandards }: { view: ExerciseRankView; unit: WeightUnit; onChangeStandards: () => void }) {
  const [changing, setChanging] = useState(false);
  const benchmark = view.benchmark as RankBenchmark;
  const { current, highest } = view;
  return (
    <div className="space-y-3">
      {current ? (
        <div className="flex items-center gap-3">
          <RankBadge position={current} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-faint">Current · best set in the last {view.windowDays} days</p>
            <p className="font-semibold">{rankLabel(current)}</p>
            <Progress position={current} benchmark={benchmark} />
          </div>
        </div>
      ) : (
        <p className="text-ink-muted">
          Inactive: no valid set in the last {view.windowDays} days. Your highest rank stays; a new set ranks you again.
        </p>
      )}
      {highest && (
        <div className="flex items-center gap-3">
          <RankBadge position={highest} size="sm" muted={!current} />
          <p className="min-w-0 flex-1">
            <span className="text-xs text-ink-faint">Highest ever · </span>
            <span className="font-medium">{rankLabel(highest)}</span>
            <span className="text-xs text-ink-faint">
              {' '}
              on {formatDay(highest.basis.day)}
              {highest.version !== benchmark.version ? ` (standards ${highest.version})` : ''}
            </span>
          </p>
        </div>
      )}
      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer text-ink">How this is worked out</summary>
        <div className="mt-2 space-y-1.5">
          {current && <p>From: {describeBasis(current, benchmark, unit)}.</p>}
          {current && workCapacityLine(current, benchmark) && <p>{workCapacityLine(current, benchmark)}</p>}
          {benchmark.note && <p>{benchmark.note}</p>}
          {benchmark.machine && <p>Machine standards are rougher: the same weight feels different on different machines.</p>}
          <p>
            {benchmark.method === 'e1rm'
              ? `Score: your Epley estimated one-rep max, scaled to a ${(benchmark.referenceBodyWeightGrams ?? 0) / 1000} kg body weight (×(reference ÷ your weight)^⅔), as a multiple of that weight.`
              : 'Score: the most reps in one set.'}{' '}
            Tiers start at {benchmark.tierStarts.slice(1).map((start) => formatRankScore(start, benchmark).replace(' body weight', '')).join(', ')}.
          </p>
          <p>{benchmark.basis}</p>
          {benchmark.draft && <p className="text-amber-600 dark:text-amber-400">Draft standards ({benchmark.version}): they may still change before they are fixed.</p>}
          {(view.excluded.implausible > 0 || view.excluded.machine > 0) && (
            <p>
              Not counted: {[view.excluded.machine && `${view.excluded.machine} set(s) with a machine attached (this standard is for the free-weight lift)`, view.excluded.implausible && `${view.excluded.implausible} set(s) beyond a plausible range`].filter(Boolean).join(', ')}.
            </p>
          )}
          <p>
            Compared with the {benchmark.standards === 'men' ? 'men’s' : 'women’s'} standards, never with other members.{' '}
            {changing ? (
              <ChooseStandards onChosen={() => { setChanging(false); onChangeStandards(); }} />
            ) : (
              <button type="button" className="text-accent underline" onClick={() => setChanging(true)}>
                Change
              </button>
            )}
          </p>
        </div>
      </details>
    </div>
  );
}

/** "Includes +3% for 4 hard sets in that workout (at most +5%)." */
export function workCapacityLine(position: RankPosition, benchmark: RankBenchmark): string | undefined {
  const { strengthScore, hardSets, bonusPercent } = position.basis;
  if (benchmark.method !== 'e1rm' || strengthScore === undefined || hardSets === undefined || bonusPercent === undefined) return undefined;
  if (bonusPercent === 0) return 'Work capacity: hard sets after the first in a workout add 1% each, up to +5%.';
  return `Includes +${bonusPercent}% work capacity for ${hardSets} hard sets in that workout (strength alone: ${formatRankScore(strengthScore, benchmark)}; at most +5%).`;
}

function Progress({ position, benchmark }: { position: RankPosition; benchmark: RankBenchmark }) {
  const score = formatRankScore(position.score, benchmark);
  if (position.nextScore === undefined) return <p className="text-xs text-ink-muted">{score} · the top division</p>;
  return (
    <>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label={`${rankLabel(position)}: ${score}, next division at ${formatRankScore(position.nextScore, benchmark)}`}
        aria-valuemin={0}
        aria-valuemax={1000}
        aria-valuenow={position.progress}
      >
        <div className="h-full rounded-full bg-accent-solid" style={{ width: `${position.progress / 10}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-ink-muted">
        {score} · next at {formatRankScore(position.nextScore, benchmark)}
      </p>
    </>
  );
}

function describeBasis(position: RankPosition, benchmark: RankBenchmark, unit: WeightUnit) {
  const b = position.basis;
  const day = formatDay(b.day);
  if (benchmark.method === 'reps') return `${b.reps} reps on ${day}`;
  const parts = [`${formatWeight(b.loadGrams ?? 0, unit)} × ${b.reps} on ${day}`];
  if (b.oneRepMaxGrams) parts.push(`est. 1RM ${formatWeight(b.oneRepMaxGrams, unit)}`);
  if (b.bodyWeightGrams && b.bodyWeightDay) parts.push(`body weight ${formatWeight(b.bodyWeightGrams, unit)} (${formatDay(b.bodyWeightDay)})`);
  return parts.join(', ');
}

/** The member's own private choice; changeable at any time, never inferred. */
function ChooseStandards({ onChosen }: { onChosen: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const profile = useApi<TrainingProfile>(PROFILE_KEY);
  async function choose(rankStandards: RankStandards) {
    setBusy(true);
    setProblem(null);
    try {
      await profile.mutate(await api.put<TrainingProfile>(PROFILE_KEY, { rankStandards }), { revalidate: false });
      onChosen();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="block">
      <span className="block text-ink-muted">
        Which standards should your lifts be compared with? Private, used only for ranks, and you can change it anytime.
      </span>
      <span className="mt-2 flex gap-2">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void choose('men')}>
          Men’s standards
        </button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => void choose('women')}>
          Women’s standards
        </button>
      </span>
      {problem && <ErrorNote message={problem} />}
    </span>
  );
}

/** The account-wide training level (#5a), linked from an exercise's statistics. */
export function TrainingLevelLink({ today }: { today: string }) {
  const portal = useApi<PortalState>('/portal');
  const enabled = !!portal.data?.access.trainingLevels;
  const { data } = useApi<TrainingLevel>(enabled ? `/training/level?today=${today}` : null);
  if (!enabled || !data) return null;
  return (
    <p className="text-xs text-ink-faint">
      <Link href="/training" className="text-accent">
        Training level {data.level}
      </Link>{' '}
      · account-wide, from all your workouts, separate from this lift’s rank
    </p>
  );
}
