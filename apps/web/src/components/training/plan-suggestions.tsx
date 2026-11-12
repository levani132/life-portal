'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';
import type { PlanListItem, SessionDetail } from '@life-portal/shared-types';
import { relativeDays } from '@life-portal/shared-domain';
import { ErrorNote } from '../ui';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { revalidateTraining, useWorkoutDay } from '../../lib/training';

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

  const start = async (plan: PlanListItem) => {
    if (!plan.nextWorkout) return;
    setStarting(plan.id);
    setError(null);
    try {
      await api.post<SessionDetail>('/training/sessions', {
        requestId: crypto.randomUUID(),
        day: workoutDay(),
        planId: plan.id,
        planWorkoutId: plan.nextWorkout.id,
      });
      await revalidateTraining();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach the server. Try again.');
    } finally {
      setStarting(null);
    }
  };

  const plans = (data ?? []).filter((plan) => plan.nextWorkout);
  if (!plans.length) return null;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="label mb-1">Next from your plans</p>
      <ul className="divide-y divide-border">
        {plans.map((plan) => (
          <li key={plan.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {plan.nextWorkout?.name} · {plan.name}
              </span>
              <span className="block truncate text-xs text-ink-faint">
                Plan {lastDoneLabel(plan.lastDoneDay, today)}
              </span>
            </span>
            <button
              type="button"
              className="btn-primary shrink-0"
              disabled={starting !== null}
              onClick={() => void start(plan)}
              aria-label={`Start ${plan.nextWorkout?.name} from ${plan.name}`}
            >
              <Play className="h-4 w-4" /> {starting === plan.id ? 'Starting…' : 'Start'}
            </button>
          </li>
        ))}
      </ul>
      {error && <ErrorNote message={error} />}
    </div>
  );
}
