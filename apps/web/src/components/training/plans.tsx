'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { PlanDetail as PlanDetailData, PlanList, PlanListItem, SessionDetail } from '@life-portal/shared-types';
import { EmptyState, ErrorNote, Panel, Spinner } from '../ui';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import {
  PLANS_KEY,
  describeTarget,
  formatDuration,
  planKey,
  revalidateTraining,
  useWeightUnit,
  useWorkoutDay,
} from '../../lib/training';

/**
 * The Plans tab (spec 023): ready-made plans and the person's own, and one plan's workouts with
 * a Start for each. Starting opens the Workout tab with the plan's sets as suggestions.
 */
export function Plans({ onStarted }: { onStarted: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (openId) return <PlanView id={openId} onBack={() => setOpenId(null)} onStarted={onStarted} />;
  return <PlansList onOpen={setOpenId} />;
}

function PlansList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, error, isLoading } = useApi<PlanList>(PLANS_KEY);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <Panel title="Ready-made plans" description="Written for this app. Copying and editing comes next.">
        {data.shared.length ? <PlanRows plans={data.shared} onOpen={onOpen} /> : <EmptyState message="No ready-made plans yet." />}
      </Panel>
      {data.own.length > 0 && (
        <Panel title="My plans">
          <PlanRows plans={data.own} onOpen={onOpen} />
        </Panel>
      )}
    </div>
  );
}

function PlanRows({ plans, onOpen }: { plans: PlanListItem[]; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-border">
      {plans.map((plan) => (
        <li key={plan.id}>
          <button type="button" className="flex w-full items-center gap-3 py-3 text-left" onClick={() => onOpen(plan.id)}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{plan.name}</span>
              <span className="block truncate text-xs text-ink-faint">
                {plan.workoutCount} {plan.workoutCount === 1 ? 'workout' : 'workouts'} · {plan.exerciseCount} exercises
                {plan.description ? ` · ${plan.description}` : ''}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlanView({ id, onBack, onStarted }: { id: string; onBack: () => void; onStarted: () => void }) {
  const { data, error, isLoading } = useApi<PlanDetailData>(planKey(id));
  const unit = useWeightUnit();
  const workoutDay = useWorkoutDay();
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState<string | null>(null);

  const start = async (planWorkoutId: string) => {
    setStarting(planWorkoutId);
    setStartError(null);
    setInProgress(null);
    try {
      const session = await api.post<SessionDetail>('/training/sessions', {
        requestId: crypto.randomUUID(),
        day: workoutDay(),
        planId: id,
        planWorkoutId,
      });
      await revalidateTraining();
      // One open workout per person: a start while one is open resumes it instead (FR-017).
      if (session.resumed) {
        setInProgress(session.plan ? `${session.plan.workoutName} · ${session.plan.planName}` : 'Another workout');
        return;
      }
      onStarted();
    } catch (caught) {
      setStartError(caught instanceof ApiError ? caught.message : 'Could not reach the server. Try again.');
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="space-y-3">
      <button type="button" className="btn-ghost" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" /> All plans
      </button>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={(error as Error).message} />}
      {data && (
        <>
          <Panel title={data.name} description={data.description}>
            {inProgress && (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                <p>{inProgress} is still in progress. Finish or discard it before starting another.</p>
                <button type="button" className="btn-ghost" onClick={onStarted}>
                  Open it
                </button>
              </div>
            )}
            {startError && <ErrorNote message={startError} />}
            {!inProgress && !startError && (
              <p className="text-xs text-ink-faint">
                Start a workout and its sets appear as suggestions. Weights come from your last time, or stay
                empty for you to fill in.
              </p>
            )}
          </Panel>
          {data.workouts.map((workout) => (
            <Panel
              key={workout.id}
              title={workout.name}
              description={`${workout.exercises.length} exercises`}
              actions={
                <button
                  type="button"
                  className="btn-primary"
                  disabled={starting !== null || !workout.exercises.length}
                  title={workout.exercises.length ? undefined : 'This workout has no exercises yet'}
                  onClick={() => void start(workout.id)}
                >
                  <Play className="h-4 w-4" /> {starting === workout.id ? 'Starting…' : 'Start'}
                </button>
              }
            >
              {workout.exercises.length ? (
                <ol className="space-y-2">
                  {workout.exercises.map((exercise) => (
                    <li key={exercise.id} className="text-sm">
                      <span className="block font-medium">
                        {exercise.exercise.name}
                        {exercise.exercise.archived && <span className="ml-2 text-xs text-ink-faint">archived</span>}
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {summariseTargets(exercise.targets.map((target) => describeTarget(exercise.exercise.measure, target, unit)))}
                        {exercise.restSeconds != null ? ` · rest ${formatDuration(exercise.restSeconds)}` : ''}
                        {exercise.note ? ` · ${exercise.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState message="No exercises in this workout yet." />
              )}
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}

/** `['8–12 reps', '8–12 reps', '8–12 reps']` → `3 × 8–12 reps`; mixed sets are listed in order. */
export function summariseTargets(parts: string[]): string {
  const groups: { text: string; count: number }[] = [];
  for (const text of parts) {
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.count++;
    else groups.push({ text, count: 1 });
  }
  return groups.map((group) => (group.count > 1 ? `${group.count} × ${group.text}` : group.text)).join(', ');
}
