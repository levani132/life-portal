'use client';

import clsx from 'clsx';
import { useState } from 'react';
import {
  EQUIPMENT_TYPES,
  MEASURES,
  MUSCLES,
  type EquipmentType,
  type Exercise,
  type Measure,
  type Muscle,
} from '@life-portal/shared-types';
import { Field, Input, Modal, Select, Textarea } from '../ui';
import { FoodPhotoField, foodPhotoPayload, type FoodPhotoChange } from '../food-photo-field';
import { api, ApiError } from '../../lib/api';
import { MEASURE_LABELS, humanise, revalidateTraining } from '../../lib/training';

/** Toggle chips for a set of muscles. */
export function MuscleChips({
  value,
  onChange,
  disabled = [],
}: {
  value: Muscle[];
  onChange: (next: Muscle[]) => void;
  disabled?: Muscle[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MUSCLES.map((muscle) => {
        const on = value.includes(muscle);
        return (
          <button
            key={muscle}
            type="button"
            aria-pressed={on}
            disabled={disabled.includes(muscle)}
            onClick={() => onChange(on ? value.filter((m) => m !== muscle) : [...value, muscle])}
            className={clsx(
              'rounded-full border px-2.5 py-1 text-xs disabled:opacity-30',
              on ? 'border-accent bg-accent/15 text-ink' : 'border-border text-ink-muted hover:text-ink',
            )}
          >
            {humanise(muscle)}
          </button>
        );
      })}
    </div>
  );
}

const splitList = (text: string, separator: RegExp) =>
  text
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Creates or edits a private exercise. Shared catalogue rows are never edited (the API answers
 * 404); the measure of an exercise already in a workout cannot change (409, shown as given).
 */
export function ExerciseForm({
  open,
  onClose,
  exercise,
  initialName = '',
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  exercise?: Exercise;
  initialName?: string;
  onSaved?: (saved: Exercise) => void;
}) {
  const editing = Boolean(exercise);
  const [name, setName] = useState(exercise?.name ?? initialName);
  const [aliases, setAliases] = useState((exercise?.aliases ?? []).join(', '));
  const [primary, setPrimary] = useState<Muscle[]>(exercise?.primaryMuscles ?? []);
  const [secondary, setSecondary] = useState<Muscle[]>(exercise?.secondaryMuscles ?? []);
  const [equipment, setEquipment] = useState<EquipmentType>(exercise?.equipmentType ?? 'machine');
  const [measure, setMeasure] = useState<Measure>(exercise?.measure ?? 'weight_reps');
  const [instructions, setInstructions] = useState((exercise?.instructions ?? []).join('\n'));
  const [photo, setPhoto] = useState<FoodPhotoChange>({ kind: 'keep' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setError('Give it a name.');
    if (!primary.length) return setError('Pick at least one main muscle.');
    setPending(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        aliases: splitList(aliases, /,/).slice(0, 10),
        primaryMuscles: primary,
        secondaryMuscles: secondary.filter((muscle) => !primary.includes(muscle)),
        equipmentType: equipment,
        measure,
        instructions: splitList(instructions, /\n/).slice(0, 20),
        ...foodPhotoPayload(photo),
      };
      const saved = exercise
        ? await api.patch<Exercise>(`/training/exercises/${exercise.id}`, body)
        : await api.post<Exercise>('/training/exercises', body);
      await revalidateTraining();
      onSaved?.(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the exercise.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${exercise?.name}` : 'Create exercise'}
      onSubmit={() => void submit()}
      submitLabel={editing ? 'Save' : 'Create'}
      pending={pending || photo.kind === 'uploading'}
      error={error}
      wide
    >
      {open && (
        <FoodPhotoField
          key={exercise?.id ?? 'new'}
          image={exercise?.image}
          onChange={setPhoto}
          hint="Only you see it, next to the exercise."
        />
      )}
      <Field label="Name">
        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
      </Field>
      <Field label="Other names" hint="Optional, separated by commas. Search finds these too.">
        <Input value={aliases} onChange={(event) => setAliases(event.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Equipment">
          <Select value={equipment} onChange={(event) => setEquipment(event.target.value as EquipmentType)}>
            {EQUIPMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanise(type)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Measured by" hint={editing ? 'Fixed once it is in a workout.' : undefined}>
          <Select value={measure} onChange={(event) => setMeasure(event.target.value as Measure)}>
            {MEASURES.map((item) => (
              <option key={item} value={item}>
                {MEASURE_LABELS[item]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div>
        <span className="label">Main muscles</span>
        <MuscleChips value={primary} onChange={setPrimary} />
      </div>
      <div>
        <span className="label">Also works</span>
        <MuscleChips value={secondary} onChange={setSecondary} disabled={primary} />
      </div>
      <Field label="How to do it" hint="Optional, one step per line.">
        <Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} />
      </Field>
    </Modal>
  );
}
