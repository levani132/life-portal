'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Play } from 'lucide-react';
import type { PlanList, PlanListItem } from '@life-portal/shared-types';
import { relativeDays } from '@life-portal/shared-domain';
import { ErrorNote } from '../ui';
import { useApi } from '../../lib/hooks';
import { PLANS_KEY, useWorkoutDay } from '../../lib/training';
import { trainingWrites } from '../../lib/training-offline';
import { GROUP_STYLES, planGroup } from '../../lib/training-colors';

/** `last done 3 days ago`, `last done today`, or `not done yet`. Display only. */
export function lastDoneLabel(lastDoneDay: string | undefined, today: string): string {
  return lastDoneDay ? `last done ${relativeDays(today, lastDoneDay)}` : 'not done yet';
}

/**
 * The Workout tab with nothing open (spec 023 US3): up to three plans used in the last 28 days,
 * each offering its next workout in one tap. Nothing shows for someone who has not used a plan.
 */
export function SuggestedPlans() {
  const workoutDay = useWorkoutDay();
  const today = workoutDay();
  const { data } = useApi<PlanListItem[]>(`/training/plans/suggested?today=${today}`);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: list } = useApi<PlanList>(PLANS_KEY);

  const start = async (plan: PlanListItem) => {
    if (!plan.nextWorkout) return;
    setStarting(plan.id);
    setError(null);
    try {
      // Spec 028: started on the device from the cached plan; sent when there is a connection.
      await trainingWrites.start(workoutDay(), { planId: plan.id, planWorkoutId: plan.nextWorkout.id });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the workout.');
    } finally {
      setStarting(null);
    }
  };

  const plans = (data ?? []).filter((plan) => plan.nextWorkout);
  if (!plans.length) return null;
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-bold">Next from your plans</h2>
      <ul className="space-y-2">
        {plans.map((plan) => {
          const style = GROUP_STYLES[planGroup(plan.id, list?.shared.findIndex((item) => item.id === plan.id))];
          const Icon = style.icon;
          return (
            <li key={plan.id} className={clsx('relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-md', style.gradient)}>
              <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10" />
              <div className="relative flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold">{plan.nextWorkout?.name}</span>
                  <span className="block truncate text-xs text-white/85">
                    {plan.name} · {lastDoneLabel(plan.lastDoneDay, today)}
                  </span>
                </span>
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-900 shadow transition-colors hover:bg-white/90 disabled:opacity-60"
                  disabled={starting !== null}
                  onClick={() => void start(plan)}
                  aria-label={`Start ${plan.nextWorkout?.name} from ${plan.name}`}
                >
                  <Play className="h-4 w-4" /> {starting === plan.id ? 'Starting…' : 'Start'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error && <div className="mt-2"><ErrorNote message={error} /></div>}
    </section>
  );
}
