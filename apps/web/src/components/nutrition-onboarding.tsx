'use client';
import { useState } from 'react';
import type { NutritionProfile, WeighIn } from '@life-portal/shared-types';
import { localDay, currentWeighIn } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { NutritionSettings } from './nutrition-settings';
import { ErrorNote, Field, Input, Spinner } from './ui';

export function NutritionOnboarding({ onSaved }: { onSaved: () => void }) {
  const profile = useApi<{ profile: NutritionProfile }>('/nutrition/profile');
  const weights = useApi<WeighIn[]>('/nutrition/weigh-ins');
  if (profile.error || weights.error)
    return (
      <ErrorNote message="Could not load your saved nutrition profile. Please retry." />
    );
  if (!profile.data || !weights.data) return <Spinner />;
  return (
    <Editor
      profile={profile.data.profile}
      weights={weights.data}
      onSaved={onSaved}
    />
  );
}
function Editor({
  profile,
  weights,
  onSaved,
}: {
  profile: NutritionProfile;
  weights: WeighIn[];
  onSaved: () => void;
}) {
  const today = localDay(new Date(), profile.dayStartHour);
  const current = currentWeighIn(weights, today);
  const [weight, setWeight] = useState(
    current ? String(current.weightGrams / 1000) : '',
  );
  const [error, setError] = useState('');
  const saveWeight = async () => {
    try {
      const grams = Math.round(Number(weight) * 1000);
      if (weight && grams !== current?.weightGrams)
        await api.put('/nutrition/weigh-ins', {
          day: today,
          weightGrams: grams,
        });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save weight.');
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Your saved numbers are filled in. Review what changed, save, or skip and
        edit these later in Food → You.
      </p>
      <Field
        label="Current weight (kg)"
        hint={
          current
            ? `Saved on ${current.day}. Leave unchanged to keep that measurement.`
            : 'Optional; needed to calculate targets.'
        }
      >
        <Input
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </Field>
      {error && <ErrorNote message={error} />}
      <NutritionSettings profile={profile} onSaved={() => void saveWeight()} />
    </div>
  );
}
