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
 * The gear that opens Training's settings. It sits at the top right of the hero, and where the
 * hero is hidden (the Workout tab during a workout) it is the last cell of the tab strip, so
 * there is always exactly one on screen.
 */
export function TrainingSettingsButton({ placement, onClick }: { placement: 'hero' | 'tabs'; onClick: () => void }) {
  return (
    <button
      type="button"
      className={
        placement === 'hero'
          ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25'
          : // Issue #30: the trailing cell of Training's tab strip, quieter than the tabs.
            'flex min-h-[3rem] w-11 shrink-0 items-center justify-center rounded-xl text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink'
      }
      onClick={onClick}
      aria-label="Training settings"
      title="Training settings"
    >
      <Settings2 size={18} aria-hidden />
    </button>
  );
}

/**
 * Training's own settings (spec 020 US5): the weight unit and the default rest. The unit is
 * display and input only; switching it rewrites no stored weight, so past lifts simply show in
 * the other unit. Rendered by the page, never inside the hero: the hero's white text would leak in.
 */
export function TrainingSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted per opening, so the form always starts from the saved profile.
  return open ? <SettingsForm onClose={onClose} /> : null;
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const profile = useTrainingProfile();
  const [unit, setUnit] = useState<WeightUnit>(profile.weightUnit);
  const [rest, setRest] = useState(String(profile.defaultRestSeconds));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
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
  );
}
