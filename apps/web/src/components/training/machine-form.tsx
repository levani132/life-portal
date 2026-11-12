'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import {
  EQUIPMENT_TYPES,
  type EquipmentType,
  type ExerciseListItem,
  type Machine,
} from '@life-portal/shared-types';
import { Field, Input, Modal, Select } from '../ui';
import { FoodPhotoField, foodPhotoPayload, type FoodPhotoChange } from '../food-photo-field';
import { api, ApiError } from '../../lib/api';
import { humanise, revalidateTraining } from '../../lib/training';
import { ExerciseSearch } from './exercise-picker';

type Linked = Pick<ExerciseListItem, 'id' | 'name'>;

/**
 * Creates or edits a specific machine ("Hammer Strength Iso-Lateral Row"), private to its
 * creator. The exercises it serves decide where it is offered first when logging.
 */
export function MachineForm({
  open,
  onClose,
  machine,
  linked: initialLinked = [],
  exerciseNames = {},
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  machine?: Machine;
  /** For a new machine: exercises to link from the start (the one being logged). */
  linked?: Linked[];
  /** Names for `machine.exerciseIds`, where the caller knows them. */
  exerciseNames?: Record<string, string>;
  onSaved?: (saved: Machine) => void;
}) {
  const [name, setName] = useState(machine?.name ?? '');
  const [brand, setBrand] = useState(machine?.brand ?? '');
  const [equipment, setEquipment] = useState<EquipmentType>(machine?.equipmentType ?? 'machine');
  const [linked, setLinked] = useState<Linked[]>(
    machine ? machine.exerciseIds.map((id) => ({ id, name: exerciseNames[id] ?? 'Exercise' })) : initialLinked,
  );
  const [picking, setPicking] = useState(false);
  const [photo, setPhoto] = useState<FoodPhotoChange>({ kind: 'keep' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setError('Give it a name.');
    setPending(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        brand: brand.trim(),
        equipmentType: equipment,
        exerciseIds: linked.map((item) => item.id),
        ...foodPhotoPayload(photo),
      };
      const saved = machine
        ? await api.patch<Machine>(`/training/machines/${machine.id}`, body)
        : await api.post<Machine>('/training/machines', { ...body, brand: body.brand || undefined });
      await revalidateTraining();
      onSaved?.(saved);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the machine.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={machine ? `Edit ${machine.name}` : 'New machine'}
        onSubmit={() => void submit()}
        submitLabel={machine ? 'Save' : 'Create'}
        pending={pending || photo.kind === 'uploading'}
        error={error}
      >
        {open && (
          <FoodPhotoField
            key={machine?.id ?? 'new'}
            image={machine?.image}
            onChange={setPhoto}
            hint="Helps you spot it in the gym. Only you see it."
          />
        )}
        <Field label="Name">
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Iso-lateral row" required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Brand" hint="optional">
            <Input value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={80} />
          </Field>
          <Field label="Type">
            <Select value={equipment} onChange={(event) => setEquipment(event.target.value as EquipmentType)}>
              {EQUIPMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanise(type)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <span className="label">Used for</span>
          <div className="flex flex-wrap gap-1.5">
            {linked.map((item) => (
              <span key={item.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs">
                {item.name}
                <button
                  type="button"
                  aria-label={`Unlink ${item.name}`}
                  className="text-ink-faint hover:text-ink"
                  onClick={() => setLinked(linked.filter((other) => other.id !== item.id))}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {linked.length < 20 && (
              <button type="button" className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-ink-muted hover:text-ink" onClick={() => setPicking(true)}>
                + Exercise
              </button>
            )}
          </div>
        </div>
      </Modal>
      <Modal open={picking} onClose={() => setPicking(false)} title="Used for which exercise?" wide>
        <ExerciseSearch
          autoFocus
          allowCreate={false}
          onPick={(exercise) => {
            if (!linked.some((item) => item.id === exercise.id)) setLinked([...linked, exercise]);
            setPicking(false);
          }}
        />
      </Modal>
    </>
  );
}
