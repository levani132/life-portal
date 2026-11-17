'use client';

import { Check, ClipboardPlus } from 'lucide-react';
import { useState } from 'react';
import { mutate } from 'swr';
import { PLAN_LIMITS, type PlanDayUpdatePreview, type PlanDayUpdateResult, type PlanList } from '@life-portal/shared-types';
import { api, ApiError, NetworkError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { PLANS_KEY, planKey } from '../../lib/training';
import { Field, Input, Modal, Select } from '../ui';
import { DayLines, planUpdateKey, readDismissed, writeDismissed } from './plan-day-update';

const NEW_PLAN = '';

/**
 * A finished workout that was not started from a plan can be kept as a plan workout: added to one
 * of the person's own plans, or to a new plan made here. The counterpart of `PlanDayUpdate` (which
 * is for workouts that were started from a plan), with the same manners: after the recap, never
 * blocking, "Not now" remembered on this device only, and once per workout.
 */
export function SaveWorkoutToPlan({ sessionId }: { sessionId: string }) {
  const { data } = useApi<PlanDayUpdatePreview>(planUpdateKey(sessionId));
  const [dismissed, setDismissed] = useState(() => readDismissed().includes(sessionId));
  const [open, setOpen] = useState(false);

  if (!data) return null;
  if (data.status === 'applied') {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-ink-muted">
        <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        {data.planName && data.workoutName
          ? `Saved as ${data.workoutName} in ${data.planName}.`
          : 'This workout was saved to a plan.'}
      </p>
    );
  }
  if (data.status !== 'saveable' || dismissed) return null;

  const dismiss = () => {
    writeDismissed([...readDismissed(), sessionId]);
    setDismissed(true);
  };
  const count = data.after.length;

  return (
    <>
      <section className="card flex flex-wrap items-center gap-3 p-4" aria-label="Save workout to a plan">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-ink" aria-hidden>
          <ClipboardPlus className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Save this workout to a plan?</p>
          <p className="truncate text-xs text-ink-faint">
            {count} {count === 1 ? 'exercise' : 'exercises'}, so you can start it again
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button type="button" className="btn-ghost flex-1 justify-center sm:flex-none" onClick={dismiss}>
            Not now
          </button>
          <button type="button" className="btn-primary flex-1 justify-center sm:flex-none" onClick={() => setOpen(true)}>
            Save
          </button>
        </div>
      </section>
      {open && <SaveToPlanSheet sessionId={sessionId} preview={data} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveToPlanSheet({
  sessionId,
  preview,
  onClose,
}: {
  sessionId: string;
  preview: PlanDayUpdatePreview;
  onClose: () => void;
}) {
  const { data: plans } = useApi<PlanList>(PLANS_KEY);
  const own = plans?.own ?? [];
  // One id per sheet, so a retried tap never saves twice.
  const [requestId] = useState(() => crypto.randomUUID());
  // Until the person picks, the choice follows the list: their most recent plan with room, else a new one.
  const [picked, setPicked] = useState<string | null>(null);
  const [planName, setPlanName] = useState('My plan');
  const [typedName, setTypedName] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFull = (workoutCount: number) => workoutCount >= PLAN_LIMITS.workouts;
  const planId = picked ?? own.find((plan) => !isFull(plan.workoutCount))?.id ?? NEW_PLAN;
  const plan = own.find((item) => item.id === planId);
  const workoutName = typedName ?? `Workout ${(plan?.workoutCount ?? 0) + 1}`;

  const save = async () => {
    if (!workoutName.trim() || (planId === NEW_PLAN && !planName.trim())) {
      setError(planId === NEW_PLAN && !planName.trim() ? 'The plan needs a name.' : 'The workout needs a name.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await api.post<PlanDayUpdateResult>(`/training/sessions/${sessionId}/plan-save`, {
        requestId,
        workoutName: workoutName.trim(),
        ...(planId === NEW_PLAN ? { planName: planName.trim() } : { planId }),
      });
      // Every plan read: the list, this plan, and the suggestions (the saved workout counts as done).
      await Promise.all([
        mutate(planUpdateKey(sessionId)),
        mutate((key) => typeof key === 'string' && key.startsWith(PLANS_KEY)),
        mutate(planKey(result.planId)),
      ]);
      onClose();
    } catch (caught) {
      if (caught instanceof NetworkError) {
        setError('Saving to a plan needs a connection. You can do it later from History.');
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not save. Try again.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Save workout to a plan"
      wide
      onSubmit={() => void save()}
      submitLabel={planId === NEW_PLAN ? 'Create plan' : 'Add to plan'}
      pending={pending}
      error={error}
    >
      <Field label="Plan">
        <Select value={planId} onChange={(event) => setPicked(event.target.value)}>
          {own.map((item) => (
            <option key={item.id} value={item.id} disabled={isFull(item.workoutCount)}>
              {item.name}
              {isFull(item.workoutCount) ? ' (full)' : ''}
            </option>
          ))}
          <option value={NEW_PLAN}>New plan…</option>
        </Select>
      </Field>
      {planId === NEW_PLAN && (
        <Field label="Plan name">
          <Input value={planName} maxLength={PLAN_LIMITS.name} onChange={(event) => setPlanName(event.target.value)} />
        </Field>
      )}
      <Field label="Workout name" hint={plan ? `Added to ${plan.name} as a new workout; its other workouts stay as they are.` : undefined}>
        <Input
          value={workoutName}
          maxLength={PLAN_LIMITS.name}
          placeholder="e.g. Push day"
          onChange={(event) => setTypedName(event.target.value)}
        />
      </Field>
      <section aria-label="Exercises">
        <h4 className="label">Exercises</h4>
        <DayLines lines={preview.after} />
      </section>
      <p className="text-xs text-ink-faint">
        Planned sets come from the sets you logged, without weights: next time each exercise starts from what you did last
        time. You can edit the plan afterwards. The workout itself, your records and ranks stay as they are.
      </p>
    </Modal>
  );
}
