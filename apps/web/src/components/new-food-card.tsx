'use client';
import { X } from 'lucide-react';
import { clampAspect, newFoodActions } from '@life-portal/shared-domain';
import type { FoodUnit } from '@life-portal/shared-types';
import type { PreparedMedia } from '../lib/media';
import { MacroRings } from './macro-rings';
import { Input, Select } from './ui';

export interface NewFoodDraft {
  name: string;
  unit: FoodUnit;
  portion: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}
export const EMPTY_FOOD: NewFoodDraft = {
  name: '',
  unit: 'g',
  portion: '100',
  kcal: '',
  protein: '',
  carbs: '',
  fat: '',
};

const number = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
/** The draft as the API's per-portion numbers: whole kcal, macros in milligrams. */
export function newFoodNumbers(draft: NewFoodDraft) {
  return {
    servingSize: Math.min(5000, Math.max(1, Math.round(number(draft.portion)))),
    energyKcal: Math.round(number(draft.kcal)),
    proteinMg: Math.round(number(draft.protein) * 1000),
    carbMg: Math.round(number(draft.carbs) * 1000),
    fatMg: Math.round(number(draft.fat) * 1000),
  };
}
export function newFoodReady(draft: NewFoodDraft) {
  return draft.name.trim().length > 0 && draft.kcal.trim() !== '';
}

/**
 * A food typed in the composer. The photo (when there is one) and the macro rings are one card:
 * no gap between them and rounded only on the outside, the same block a post shows.
 */
export function NewFoodCard({
  draft,
  onChange,
  photo,
  save,
  log,
  onSave,
  onLog,
  slotLabel,
  onRemove,
  onKeep,
  onPost,
  busy,
  disabled,
}: {
  draft: NewFoodDraft;
  onChange: (draft: NewFoodDraft) => void;
  photo?: PreparedMedia;
  save: boolean;
  log: boolean;
  onSave: (value: boolean) => void;
  onLog: (value: boolean) => void;
  slotLabel: string;
  onRemove: () => void;
  onKeep: () => void;
  onPost: () => void;
  busy: boolean;
  /** Uploads still running, or the draft is not complete. */
  disabled: boolean;
}) {
  const facts = newFoodNumbers(draft);
  const actions = newFoodActions({ save, log });
  const set = (field: keyof NewFoodDraft) => (event: { target: { value: string } }) =>
    onChange({ ...draft, [field]: event.target.value });
  return (
    <section className="mx-4 mb-4 mt-3" aria-label="New food">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-raised">
        {photo && (
          <div
            className="relative bg-black"
            style={{ aspectRatio: String(clampAspect(photo.width, photo.height)) }}
          >
            {photo.kind === 'video' ? (
              <video src={photo.previewUrl} muted playsInline loop autoPlay className="h-full w-full object-cover" />
            ) : (
              <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
        )}
        <div className="p-3">
          <p className="mb-2 truncate pr-8 text-sm font-semibold">
            {draft.name.trim() || 'New food'}
            <span className="ml-1 font-normal text-ink-muted">
              · {facts.servingSize} {draft.unit}
            </span>
          </p>
          <MacroRings
            kcal={facts.energyKcal}
            proteinMg={facts.proteinMg}
            carbMg={facts.carbMg}
            fatMg={facts.fatMg}
          />
        </div>
        <button
          type="button"
          aria-label="Remove new food"
          onClick={onRemove}
          className={`absolute right-2 flex h-7 w-7 items-center justify-center rounded-full ${photo ? 'top-2 bg-black/60 text-white' : 'top-2 text-ink-muted hover:bg-ink/5'}`}
        >
          <X size={15} />
        </button>
      </div>

      <fieldset disabled={busy} className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs text-ink-muted">
          Name
          <Input
            className="mt-1"
            value={draft.name}
            maxLength={160}
            placeholder="What is it?"
            onChange={set('name')}
          />
        </label>
        <label className="text-xs text-ink-muted">
          Portion
          <Input className="mt-1" inputMode="decimal" value={draft.portion} onChange={set('portion')} />
        </label>
        <label className="text-xs text-ink-muted">
          Unit
          <Select className="mt-1" value={draft.unit} onChange={set('unit')}>
            <option value="g">grams</option>
            <option value="ml">millilitres</option>
          </Select>
        </label>
        <label className="text-xs text-ink-muted">
          Calories (kcal)
          <Input className="mt-1" inputMode="numeric" value={draft.kcal} onChange={set('kcal')} />
        </label>
        <label className="text-xs text-ink-muted">
          Protein (g)
          <Input className="mt-1" inputMode="decimal" value={draft.protein} onChange={set('protein')} />
        </label>
        <label className="text-xs text-ink-muted">
          Carbs (g)
          <Input className="mt-1" inputMode="decimal" value={draft.carbs} onChange={set('carbs')} />
        </label>
        <label className="text-xs text-ink-muted">
          Fat (g)
          <Input className="mt-1" inputMode="decimal" value={draft.fat} onChange={set('fat')} />
        </label>
        <p className="col-span-2 text-[11px] text-ink-faint">Numbers for the portion above.</p>
      </fieldset>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[rgb(var(--accent))]"
            checked={save}
            disabled={busy}
            onChange={(event) => onSave(event.target.checked)}
          />
          Save to my foods
        </label>
        <label className={`flex items-center gap-2.5 text-sm ${actions.canLog ? '' : 'opacity-40'}`}>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[rgb(var(--accent))]"
            checked={actions.log}
            disabled={busy || !actions.canLog}
            onChange={(event) => onLog(event.target.checked)}
          />
          Log as {slotLabel.toLowerCase()} now
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        {actions.keep && (
          <button type="button" className="btn flex-1" disabled={busy || disabled} onClick={onKeep}>
            {actions.keep}
          </button>
        )}
        <button type="button" className="btn-primary flex-1" disabled={busy || disabled} onClick={onPost}>
          {busy ? 'Working…' : actions.post}
        </button>
      </div>
    </section>
  );
}
