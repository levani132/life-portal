'use client';

import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MEAL_SLOTS, type Food, type MealSlot, type SavedMeal } from '@life-portal/shared-types';
import { mgToG, servingsProblem, servingsText } from '@life-portal/shared-domain';
import { useAction } from '../lib/hooks';
import { foodWrites } from '../lib/nutrition-offline';
import { ErrorNote, Field, Modal, Select } from './ui';

const SLOT_NAMES: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', uncategorized: 'Anything else' };
const QUICK = [0.5, 1, 1.5, 2];

/**
 * Logging a recipe (spec 044): how many of its servings, and at which meal. Each food is scaled
 * alike and logged as its own meal, grouped as the recipe in the day. Works offline like any
 * other logging; the numbers shown are the recipe's as they are now.
 */
export function LogRecipeSheet({
  meal,
  foods,
  day,
  slot: initialSlot,
  onClose,
  onLogged,
}: {
  meal: SavedMeal | null;
  foods: Food[];
  day: string;
  slot?: MealSlot;
  onClose: () => void;
  onLogged: () => void;
}) {
  const action = useAction();
  const [servings, setServings] = useState(1);
  const [slot, setSlot] = useState<MealSlot>(initialSlot ?? meal?.defaultSlot ?? 'uncategorized');
  useEffect(() => {
    setServings(1);
    setSlot(initialSlot ?? meal?.defaultSlot ?? 'uncategorized');
  }, [meal, initialSlot]);
  if (!meal) return null;
  const makes = meal.servings ?? 1;
  const share = servings / makes;
  const kcal = Math.round(meal.totals.energyKcal * share);
  const grams = (mg: number) => mgToG(Math.round(mg * share));
  const problem = servingsProblem(servings);
  const step = (by: number) => setServings((now) => Math.min(20, Math.max(0.25, Math.round((now + by) * 4) / 4)));

  return (
    <Modal
      open
      onClose={onClose}
      title={`Log ${meal.name}`}
      submitLabel={action.pending ? 'Logging…' : 'Log it'}
      pending={action.pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (problem) return;
        void action
          .run(() => foodWrites.logSavedMeal(meal, foods, { day, slot, servings }), { revalidate: false })
          .then((ok) => {
            if (ok) {
              onLogged();
              onClose();
            }
          });
      }}
    >
      <div className="space-y-4">
        <Field label={makes > 1 ? `Servings (it makes ${makes})` : 'How much of it'}>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost h-11 w-11 justify-center border border-border" aria-label="A quarter less" onClick={() => step(-0.25)}>
              <Minus size={16} />
            </button>
            <span className="min-w-[4rem] text-center text-xl font-bold tabular">{servingsText(servings)}</span>
            <button type="button" className="btn-ghost h-11 w-11 justify-center border border-border" aria-label="A quarter more" onClick={() => step(0.25)}>
              <Plus size={16} />
            </button>
            <span className="text-sm text-ink-muted">{makes > 1 ? (servings === 1 ? 'serving' : 'servings') : servings === 1 ? 'the whole recipe' : '× the recipe'}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={servings === value}
                onClick={() => setServings(value)}
                className={`rounded-full border px-3 py-1 text-sm ${servings === value ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted'}`}
              >
                {servingsText(value)}
              </button>
            ))}
            {makes > 1 && (
              <button
                type="button"
                aria-pressed={servings === makes}
                onClick={() => setServings(makes)}
                className={`rounded-full border px-3 py-1 text-sm ${servings === makes ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted'}`}
              >
                All {makes}
              </button>
            )}
          </div>
        </Field>
        <Field label="Meal">
          <Select value={slot} onChange={(event) => setSlot(event.target.value as MealSlot)}>
            {MEAL_SLOTS.map((each) => (
              <option key={each} value={each}>
                {SLOT_NAMES[each]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-xl bg-surface px-3 py-2 text-sm">
          <p className="font-semibold">
            {kcal.toLocaleString('en-GB')} kcal · P {grams(meal.totals.proteinMg)} g · C {grams(meal.totals.carbMg)} g · F {grams(meal.totals.fatMg)} g
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {meal.components.length} {meal.components.length === 1 ? 'food' : 'foods'}, each logged at {Math.round(share * 100)}% of the recipe. You can change any one of them after.
          </p>
        </div>
        {problem && <p className="text-xs text-warning">{problem}</p>}
        {action.error && <ErrorNote message={action.error} />}
      </div>
    </Modal>
  );
}
