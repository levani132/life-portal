'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FoodWithUsage, MealEntry, MealSlot } from '@life-portal/shared-types';
import { MEAL_SLOTS } from '@life-portal/shared-types';
import {
  amountToServings,
  entryTotals,
  formatDay,
  mgToG,
  servingsToAmount,
} from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { FoodPicker } from './food-picker';
import { useAction } from '../lib/hooks';
import { Field, Input, Modal, Select } from './ui';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  uncategorized: 'Uncategorised',
};

/**
 * The one place a meal gets logged, mounted from the dashboard card and from every slot heading.
 *
 * Two details that matter more than they look:
 *
 * 1. **Servings and the base amount stay in sync.** Whichever field is typed in wins, and the
 *    other follows — the stored row is always base units, so a later edit to the food's serving
 *    size cannot change what was eaten.
 * 2. **The preview uses `entryTotals`, the same domain function the API uses to store the row.**
 *    The number shown before saving and the number saved cannot disagree.
 */
export function LogFoodModal({
  open,
  onClose,
  foods,
  day,
  slot: initialSlot,
  entry,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  foods: FoodWithUsage[];
  day: string;
  slot: MealSlot;
  /** Present when correcting an already-logged entry. */
  entry?: MealEntry;
  onLogged?: () => void;
}) {
  const editing = entry != null;
  const { run, pending, error, clearError } = useAction();

  const [slot, setSlot] = useState<MealSlot>(entry?.slot ?? initialSlot);
  const [foodId, setFoodId] = useState<string | undefined>(entry?.foodId);
  const [amountText, setAmountText] = useState(entry ? String(entry.amount) : '');
  const [servingsText, setServingsText] = useState(entry ? String(entry.servings) : '');
  const [entryDay, setEntryDay] = useState(entry?.day ?? day);

  // Reopening for a different slot, day or entry must not show the last one's numbers.
  useEffect(() => {
    if (!open) return;
    clearError();
    setSlot(entry?.slot ?? initialSlot);
    setFoodId(entry?.foodId);
    setEntryDay(entry?.day ?? day);
    setAmountText(entry ? String(entry.amount) : '');
    setServingsText(entry ? String(entry.servings) : '');
  }, [open, entry, initialSlot, day, clearError]);

  const food = useMemo(() => foods.find((row) => row.id === foodId), [foods, foodId]);
  // When editing, the entry's frozen snapshot is the truth, not the food's current numbers.
  const facts = entry?.facts ?? food;
  const servingSize = entry?.facts.servingSize ?? food?.servingSize ?? 100;
  const unit = entry?.unit ?? food?.unit ?? 'g';

  const amount = Number(amountText);
  const validAmount = Number.isFinite(amount) && amount >= 1;
  const preview = facts && validAmount ? entryTotals(Math.round(amount), facts) : undefined;

  const setFromServings = (text: string) => {
    setServingsText(text);
    const servings = Number(text);
    setAmountText(
      text === '' || !Number.isFinite(servings) || servings <= 0
        ? ''
        : String(servingsToAmount(servings, servingSize)),
    );
  };

  const setFromAmount = (text: string) => {
    setAmountText(text);
    const next = Number(text);
    setServingsText(
      text === '' || !Number.isFinite(next) || next <= 0
        ? ''
        : String(amountToServings(next, servingSize)),
    );
  };

  const submit = () =>
    void run(async () => {
      if (editing) {
        await api.patch(`/nutrition/entries/${entry.id}`, {
          slot,
          day: entryDay,
          amount: Math.round(amount),
        });
      } else {
        await api.post('/nutrition/entries', {
          day: entryDay,
          slot,
          foodId,
          amount: Math.round(amount),
        });
      }
    }).then((ok) => {
      if (ok) {
        onLogged?.();
        onClose();
      }
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Correct ${entry.facts.name}` : 'Log food'}
      onSubmit={submit}
      submitLabel={editing ? 'Save' : 'Record meal'}
      pending={pending}
      error={error}
      wide
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Meal">
          <Select value={slot} onChange={(event) => setSlot(event.target.value as MealSlot)}>
            {MEAL_SLOTS.map((option) => (
              <option key={option} value={option}>
                {SLOT_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Day" hint={entryDay === day ? formatDay(day) : 'not today'}>
          <Input
            type="date"
            value={entryDay}
            onChange={(event) => setEntryDay(event.target.value)}
          />
        </Field>
      </div>

      {editing ? (
        <div className="rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium">{entry.facts.name}</p>
          <p className="text-xs text-ink-faint">
            Logged with {entry.facts.energyKcalPer100} kcal per 100 {unit}. Correcting the amount
            keeps those numbers — a different food is a different meal.
          </p>
        </div>
      ) : (
        <Field label="Food">
          <FoodPicker foods={foods} selectedId={foodId} onSelect={(picked) => setFoodId(picked.id)} />
        </Field>
      )}

      {facts && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Servings" hint={`1 serving = ${servingSize} ${unit}`}>
              <Input
                inputMode="decimal"
                placeholder="1"
                value={servingsText}
                onChange={(event) => setFromServings(event.target.value)}
              />
            </Field>
            <Field label={`Amount in ${unit}`} hint="whichever you prefer — they stay in sync">
              <Input
                inputMode="numeric"
                placeholder={String(servingSize)}
                value={amountText}
                onChange={(event) => setFromAmount(event.target.value)}
              />
            </Field>
          </div>

          {amount > 3000 && (
            <p className="text-xs text-amber-400">
              {Math.round(amount)} {unit} is a lot — worth a second look in case a digit slipped.
            </p>
          )}

          <div className="rounded-lg border border-lime-500/30 bg-lime-500/5 p-3">
            <p className="label mb-2">This will add</p>
            {preview ? (
              <dl className="grid grid-cols-4 gap-2 text-center">
                <PreviewFigure label="kcal" value={preview.energyKcal} />
                <PreviewFigure label="protein" value={mgToG(preview.proteinMg)} suffix="g" />
                <PreviewFigure label="carbs" value={mgToG(preview.carbMg)} suffix="g" />
                <PreviewFigure label="fat" value={mgToG(preview.fatMg)} suffix="g" />
              </dl>
            ) : (
              <p className="text-sm text-ink-faint">Enter servings or an amount.</p>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function PreviewFigure({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div>
      <dd className="tabular text-lg font-semibold text-ink">
        {value}
        {suffix && <span className="ml-0.5 text-xs font-normal text-ink-faint">{suffix}</span>}
      </dd>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
    </div>
  );
}
