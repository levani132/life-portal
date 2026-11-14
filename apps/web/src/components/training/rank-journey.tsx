'use client';

import clsx from 'clsx';
import { Check, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { RANK_TIERS, type ExerciseRankView, type RankBenchmark, type WeightUnit } from '@life-portal/shared-types';
import { oneRepMaxToNextGrams, rankLabel, rankLadder, type RankLadderRung } from '@life-portal/shared-domain';
import { formatWeight } from '../../lib/training';
import { EstimateMark } from '../ui';
import { RankEmblem } from './rank-emblem';

/** A rung, or a tier alone when there is no exercise (and so no thresholds). */
type RankLadderRungLike = Omit<RankLadderRung, 'starts'> & { starts?: RankLadderRung['starts'] };

/** "1.30×" or "25": a threshold, short enough for three in a row. */
function shortScore(score: number, benchmark: Pick<RankBenchmark, 'method'>) {
  return benchmark.method === 'reps' ? String(score) : `${(score / 1000).toFixed(2)}×`;
}

/**
 * The rank journey (#13): all eight tiers with their III/II/I thresholds, where the member stands,
 * and how ranks differ from levels and tournaments. Opened from an exercise's rank ("All ranks"),
 * when it always names the exercise and shows its thresholds, or from the training level, when it
 * shows the tiers alone because thresholds belong to an exercise. Reads the existing rank view:
 * nothing is scored here, and the v1 standards and tournament rules are untouched.
 */
export function RankJourney({
  exerciseName,
  view,
  unit = 'kg',
  tournaments = false,
}: {
  exerciseName?: string;
  view?: ExerciseRankView;
  unit?: WeightUnit;
  /** Explain tournaments only where the member can see them. */
  tournaments?: boolean;
}) {
  const benchmark = view?.benchmark;
  const current = view?.current;
  const highest = view?.highest;
  const ladder: RankLadderRungLike[] = benchmark
    ? rankLadder(benchmark.tierStarts, current, highest)
    : [...RANK_TIERS].reverse().map((tier, i) => ({ tier, index: 7 - i, state: 'locked' as const, division: 'I' as const }));
  const here = useRef<HTMLLIElement>(null);

  // Legend is at the top; open scrolled to where the member is.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    here.current?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  const toNext = current && benchmark?.method === 'e1rm' ? oneRepMaxToNextGrams(current, benchmark.standards) : undefined;
  const repsToNext = current && benchmark?.method === 'reps' && current.nextScore !== undefined ? current.nextScore - current.score : undefined;
  const hero = current ?? highest;

  return (
    <div className="space-y-4">
      {benchmark && (
        <section className="rounded-2xl border border-border p-4 text-center" aria-label="Your rank">
          <p className="text-xs text-ink-faint">{exerciseName ?? 'This exercise'}</p>
          {hero ? (
            <>
              <RankEmblem
                tier={hero.tier}
                division={hero.division}
                size={88}
                muted={!current}
                animate={hero.tier === 'Legend'}
                className="mx-auto mt-2"
              />
              <p className="mt-2 text-lg font-bold">{rankLabel(hero)}</p>
              <p className="text-xs text-ink-faint">
                {current ? `Current · best set in the last ${view?.windowDays ?? 90} days` : 'Highest ever · no valid set lately'}
              </p>
              {current && current.nextScore !== undefined && (
                <>
                  <div
                    className="mx-auto mt-3 h-2 max-w-xs overflow-hidden rounded-full bg-border"
                    role="progressbar"
                    aria-label={`Progress to the next division, at ${shortScore(current.nextScore, benchmark)}`}
                    aria-valuemin={0}
                    aria-valuemax={1000}
                    aria-valuenow={current.progress}
                  >
                    <div className="h-full rounded-full bg-accent-solid" style={{ width: `${current.progress / 10}%` }} />
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-ink-muted">
                    {shortScore(current.score, benchmark)} now · next division at {shortScore(current.nextScore, benchmark)}
                    {benchmark.method === 'e1rm' && ' body weight'}
                  </p>
                  {toNext !== undefined && toNext > 0 && (
                    <p className="text-xs text-ink-faint">
                      About {formatWeight(toNext, unit)} more on your estimated one-rep max
                      <EstimateMark basis="The score formula run backwards: same body weight and the same work-capacity bonus as your ranked workout." />
                    </p>
                  )}
                  {repsToNext !== undefined && repsToNext > 0 && (
                    <p className="text-xs text-ink-faint">{repsToNext} more {repsToNext === 1 ? 'rep' : 'reps'} in one set</p>
                  )}
                </>
              )}
              {current && current.nextScore === undefined && <p className="mt-1 text-xs text-ink-muted">The top division.</p>}
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Not ranked yet. Log a working set to get a rank.</p>
          )}
          {benchmark.provisional && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">Provisional standard: a rough guide.</p>
          )}
        </section>
      )}

      <section aria-label="All ranks">
        <h3 className="label">All ranks</h3>
        {benchmark ? (
          <p className="text-xs text-ink-faint">
            Where each division starts for {exerciseName ?? 'this exercise'} (III · II · I),{' '}
            {benchmark.method === 'reps' ? 'in reps in one set' : 'as a multiple of body weight'}. Standards {benchmark.version}.
          </p>
        ) : (
          <p className="text-xs text-ink-faint">
            Eight tiers, each split into III, II and I. Where each starts depends on the exercise: open an exercise’s Rank tab to
            see its thresholds.
          </p>
        )}
        <ol className="mt-2 divide-y divide-border">
          {ladder.map((rung) => {
            const isHere = rung.state === 'current';
            return (
              <li
                key={rung.tier}
                ref={isHere ? here : undefined}
                aria-current={isHere ? 'step' : undefined}
                className={clsx('flex items-center gap-3 py-2', isHere && '-mx-2 rounded-xl bg-accent/10 px-2')}
              >
                <RankEmblem
                  tier={rung.tier}
                  division={rung.division}
                  size={32}
                  locked={!!benchmark && rung.state === 'locked'}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{rung.tier}</p>
                  {benchmark && rung.starts && (
                    <p className="text-xs tabular-nums text-ink-faint">
                      {rung.starts.map((start, i) => (
                        <span key={i} className={clsx(isHere && current && current.milestone === rung.index * 3 + i && 'font-bold text-ink')}>
                          {i > 0 && ' · '}
                          {shortScore(start, benchmark)}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {benchmark && (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                    {rung.state === 'current' ? (
                      <>You · {rung.division}</>
                    ) : rung.state === 'reached' ? (
                      <>
                        <Check className="h-3.5 w-3.5" aria-hidden /> Reached
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5" aria-hidden /> Locked
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-label="How ranks work" className="space-y-2">
        <h3 className="label">How ranks work</h3>
        <div className="rounded-xl border border-border p-3 text-xs text-ink-muted">
          <p className="font-semibold text-ink">Rank: how strong, per exercise.</p>
          <p className="mt-0.5">
            Your best set from the last 90 days, compared with fixed published standards, never with other members. If you stop
            training a lift its current rank can fall; your highest-ever rank stays.
          </p>
        </div>
        <div className="rounded-xl border border-border p-3 text-xs text-ink-muted">
          <p className="font-semibold text-ink">Level: how much you train.</p>
          <p className="mt-0.5">Earned from every workout, on any exercise, and it only goes up. It says nothing about strength.</p>
        </div>
        {tournaments && (
          <div className="rounded-xl border border-border p-3 text-xs text-ink-muted">
            <p className="font-semibold text-ink">Tournaments: monthly, if you join.</p>
            <p className="mt-0.5">Your rank only decides which group you are placed in, with people of a similar rank. Results never change your rank.</p>
          </div>
        )}
      </section>
    </div>
  );
}
