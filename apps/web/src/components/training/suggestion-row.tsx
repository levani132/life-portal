'use client';

import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { Measure, PlanTarget, SessionExercise, SetValues } from '@life-portal/shared-types';
import { setFieldsFor, validateSetValues } from '@life-portal/shared-domain';
import { describeSet, describeTarget, prefillFor, useWeightUnit } from '../../lib/training';
import type { SetFormValue } from './set-row';

/**
 * What the next set from a plan should start with (spec 023 research R6): last time's set at the
 * same position, else the plan's target. With no history, a weight logged earlier in this
 * workout is carried over, so the second set of a new exercise is still one tap.
 */
export function suggestionValue(
  exercise: SessionExercise,
  target: PlanTarget,
  position: number,
  lastLogged: SetValues | undefined,
): { value: SetFormValue; source: 'last_time' | 'plan' } {
  const measure = exercise.snapshot.measure;
  const prefill = prefillFor(measure, target, exercise.previous?.sets, position);
  const values: SetValues = { ...prefill.values };
  if (prefill.source === 'plan' && lastLogged) {
    for (const field of setFieldsFor(measure).allowed) {
      if (values[field] === undefined && lastLogged[field] !== undefined) values[field] = lastLogged[field];
    }
  }
  return { value: { type: prefill.type, ...values }, source: prefill.source };
}

/**
 * The planned sets still to do, as rows under the logged ones. The first is pre-filled and
 * logs in one tap when it is complete; the form below starts from the same values for an edit
 * first. Suggestions are never data: nothing here is sent until a set is logged.
 */
export function SuggestionRows({
  measure,
  targets,
  firstIndex,
  first,
  onLog,
}: {
  measure: Measure;
  targets: PlanTarget[];
  /** The set number the first suggestion would get. */
  firstIndex: number;
  first?: { value: SetFormValue; source: 'last_time' | 'plan' };
  onLog: (value: SetFormValue) => void;
}) {
  const unit = useWeightUnit();
  if (!targets.length) return null;
  const ready = first && !validateSetValues(measure, first.value);
  return (
    <ul className="mb-2">
      {targets.map((target, index) => {
        const isFirst = index === 0;
        return (
          <li
            key={index}
            className={clsx(
              'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm tabular-nums',
              isFirst ? 'border border-dashed border-accent/50 bg-accent/5' : 'opacity-60',
            )}
          >
            <span
              className={clsx(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-dashed text-xs font-bold',
                target.type === 'warmup' ? 'border-train-core/50 text-train-core' : 'border-accent/50 text-accent',
              )}
            >
              {target.type === 'warmup' ? 'W' : firstIndex + index}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink-muted">Plan: {describeTarget(measure, target, unit)}</span>
              {isFirst && first && (
                <span className="block truncate text-xs text-ink-faint">
                  {ready ? describeSet(first.value, measure, unit) : 'Fill in the set below'}
                  {' · '}
                  {first.source === 'last_time' ? 'from last time' : 'from the plan'}
                </span>
              )}
            </span>
            {isFirst && (
              <button
                type="button"
                className="btn-primary shrink-0 px-2.5"
                disabled={!ready}
                onClick={() => first && onLog(first.value)}
                aria-label="Log this set as suggested"
                title={ready ? 'Log as suggested' : 'Fill in the set below first'}
              >
                <Check className="h-4 w-4" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
