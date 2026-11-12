'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { WEIGHT_UNITS, type TrainingProfile, type WeightUnit } from '@life-portal/shared-types';
import { Field, Input, Modal } from '../ui';
import { api } from '../../lib/api';
import { revalidate } from '../../lib/hooks';
import { PROFILE_KEY, revalidateTraining, useTrainingProfile } from '../../lib/training';

const UNIT_LABELS: Record<WeightUnit, string> = { kg: 'Kilograms (kg)', lb: 'Pounds (lb)' };

/**
 * Training's own settings (spec 020 US5): the weight unit and the default rest. The unit is
 * display and input only; switching it rewrites no stored weight, so past lifts simply show in
 * the other unit.
 */
export function TrainingSettings() {
  const profile = useTrainingProfile();
  const [open, setOpen] = useState(false);
  const [unit, setUnit] = useState<WeightUnit>(profile.weightUnit);
  const [rest, setRest] = useState(String(profile.defaultRestSeconds));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = () => {
    setUnit(profile.weightUnit);
    setRest(String(profile.defaultRestSeconds));
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    const seconds = Number(rest);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 900) {
      setError('Rest must be a whole number of seconds, 0 to 900.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.put<TrainingProfile>(PROFILE_KEY, { weightUnit: unit, defaultRestSeconds: seconds });
      // Everything that shows a weight re-reads, including the Home card.
      await Promise.all([revalidateTraining(), revalidate('/dashboard')]);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-ghost" onClick={show} aria-label="Training settings" title="Training settings">
        <Settings2 size={18} aria-hidden />
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Training settings"
        onSubmit={() => void save()}
        pending={pending}
        error={error}
      >
        <fieldset>
          <legend className="label">Weight unit</legend>
          <div className="flex gap-1 rounded-lg border border-border p-1" role="radiogroup" aria-label="Weight unit">
            {WEIGHT_UNITS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={unit === item}
                className={clsx(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium',
                  unit === item ? 'bg-surface text-ink' : 'text-ink-faint hover:text-ink',
                )}
                onClick={() => setUnit(item)}
              >
                {UNIT_LABELS[item]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            Every weight is shown and typed in this unit. Logged weights are not changed.
          </p>
        </fieldset>
        <Field label="Default rest (seconds)" hint="The rest timer after each set.">
          <Input inputMode="numeric" value={rest} onChange={(event) => setRest(event.target.value)} />
        </Field>
      </Modal>
    </>
  );
}
