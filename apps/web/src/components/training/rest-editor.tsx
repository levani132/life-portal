'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { mutate } from 'swr';
import { PLAN_LIMITS, type PlanDetail, type SessionDetail, type SessionExercise } from '@life-portal/shared-types';
import { Input, Modal } from '../ui';
import { api, ApiError, NetworkError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { PLANS_KEY, formatDuration, parseDuration, planKey } from '../../lib/training';
import { trainingWrites } from '../../lib/training-offline';
import { exerciseRest, planInputOf } from '../../lib/training-workout';

const PRESETS = [30, 45, 60, 90, 120, 150, 180, 240];

/**
 * Spec 025: the rest after a set of one exercise, for this workout. Saved on the workout exercise
 * (`restSeconds`), never on its frozen `planned` copy. "Also save to plan" writes the same rest
 * into the person's own plan, so next time starts with it.
 */
export function RestEditor({
  session,
  exercise,
  defaultSeconds,
  onClose,
}: {
  session: SessionDetail;
  exercise: SessionExercise;
  defaultSeconds: number;
  onClose: () => void;
}) {
  const current = exerciseRest(exercise);
  const [text, setText] = useState(formatDuration(current ?? defaultSeconds));
  const [toPlan, setToPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { data: plan } = useApi<PlanDetail>(session.plan && exercise.planned ? planKey(session.plan.planId) : null, {
    shouldRetryOnError: false,
  });
  const inPlan =
    plan?.isOwn && exercise.planned
      ? plan.workouts.some((workout) => workout.exercises.some((item) => item.id === exercise.planned?.planExerciseId))
      : false;

  const save = async (seconds: number | null) => {
    setPending(true);
    setError(null);
    try {
      // Spec 028: this workout's rest works offline; changing the plan itself needs a connection.
      await trainingWrites.patchExercise(session.id, exercise, { restSeconds: seconds });
      if (toPlan && inPlan && plan && exercise.planned) {
        const input = planInputOf(plan);
        for (const workout of input.workouts) {
          for (const item of workout.exercises) {
            if (item.id !== exercise.planned.planExerciseId) continue;
            if (seconds === null) delete item.restSeconds;
            else item.restSeconds = seconds;
          }
        }
        const saved = await api.put<PlanDetail>(`/training/plans/${plan.id}`, input);
        await Promise.all([mutate(PLANS_KEY), mutate(planKey(plan.id), saved, { revalidate: false })]);
      }
      onClose();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof NetworkError
            ? 'Saved for this workout. The plan can be changed once there is a connection.'
            : 'Could not save the rest. Try again.',
      );
    } finally {
      setPending(false);
    }
  };

  const typed = parseDuration(text);
  const valid = typed !== undefined && typed >= 0 && typed <= PLAN_LIMITS.restMax;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rest after ${exercise.snapshot.name}`}
      onSubmit={() => {
        if (valid) void save(typed);
        else setError(`Rest is between 0:00 and ${formatDuration(PLAN_LIMITS.restMax)}.`);
      }}
      pending={pending}
      error={error}
    >
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            className={clsx(
              'rounded-full border px-3 py-1.5 text-sm tabular-nums transition-colors',
              typed === seconds ? 'border-train-pull bg-train-pull/15 font-semibold text-train-pull' : 'border-border hover:bg-surface',
            )}
            onClick={() => setText(formatDuration(seconds))}
          >
            {formatDuration(seconds)}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="label">Rest (m:ss)</span>
        <Input inputMode="text" value={text} onChange={(event) => setText(event.target.value)} placeholder="m:ss" />
      </label>
      {inPlan && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={toPlan} onChange={(event) => setToPlan(event.target.checked)} />
          Also save to {plan?.name}
        </label>
      )}
      {exercise.restSeconds != null && (
        <button
          type="button"
          className="text-xs text-ink-faint underline"
          disabled={pending}
          onClick={() => void save(null)}
        >
          Go back to {exercise.planned?.restSeconds != null ? `the plan's ${formatDuration(exercise.planned.restSeconds)}` : `your default ${formatDuration(defaultSeconds)}`}
        </button>
      )}
    </Modal>
  );
}
