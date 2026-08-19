'use client';

import { useState } from 'react';
import type { WeighIn } from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { EmptyState, Field, Input, Panel } from './ui';

/**
 * Weigh-ins are event rows, not a field on the profile: the latest is the current weight, the
 * history draws the trend, and a back-dated correction fixes the past properly (principle III).
 * One per day — stepping on the scale twice corrects the figure rather than stacking rows.
 */
export function WeighInPanel({
  weighIns,
  today,
  onSaved,
}: {
  weighIns: WeighIn[];
  today: string;
  onSaved?: () => void;
}) {
  const { run, pending, error } = useAction();
  const [day, setDay] = useState(today);
  const [weightKg, setWeightKg] = useState('');
  const [bodyFatPct, setBodyFatPct] = useState('');

  const save = () =>
    void run(async () => {
      const kg = Number(weightKg);
      if (!Number.isFinite(kg) || kg <= 0) throw new Error('A weight is needed.');
      const fat = bodyFatPct.trim() === '' ? undefined : Number(bodyFatPct) / 100;
      await api.put('/nutrition/weigh-ins', {
        day,
        weightGrams: Math.round(kg * 1000),
        bodyFatPct: fat,
      });
    }).then((ok) => {
      if (ok) {
        setWeightKg('');
        setBodyFatPct('');
        onSaved?.();
      }
    });

  const remove = (id: string) => void run(async () => api.delete(`/nutrition/weigh-ins/${id}`));

  const recent = [...weighIns].reverse().slice(0, 8);

  return (
    <Panel
      title="Weigh-ins"
      description="The latest one is your current weight. Record a body-fat percentage and the calorie maths switches to the lean-mass equation."
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Day">
          <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </Field>
        <Field label="Weight (kg)">
          <Input
            inputMode="decimal"
            value={weightKg}
            onChange={(event) => setWeightKg(event.target.value)}
            placeholder="80.4"
          />
        </Field>
        <Field label="Body fat (%)" hint="optional, if measured">
          <Input
            inputMode="decimal"
            value={bodyFatPct}
            onChange={(event) => setBodyFatPct(event.target.value)}
            placeholder="18"
          />
        </Field>
        <div className="flex items-end">
          <button type="button" className="btn-primary w-full" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Record'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      <div className="mt-4">
        {recent.length === 0 ? (
          <EmptyState message="No weigh-ins yet. One is enough to get your targets." />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {recent.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-ink-muted">{formatDay(row.day)}</span>
                <span className="tabular">
                  {(row.weightGrams / 1000).toFixed(1)} kg
                  {row.bodyFatPct != null && (
                    <span className="ml-2 text-ink-faint">
                      {Math.round(row.bodyFatPct * 1000) / 10}% fat
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="p-1 text-xs text-ink-faint hover:text-rose-300"
                  onClick={() => remove(row.id)}
                  aria-label={`Remove the weigh-in from ${formatDay(row.day)}`}
                  disabled={pending}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
