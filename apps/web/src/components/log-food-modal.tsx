'use client';

import clsx from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Cookie,
  Minus,
  Moon,
  Plus,
  Sun,
  Sunrise,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  EntryTotals,
  FoodWithUsage,
  MealEntry,
  MealSlot,
  NutritionOverview,
} from '@life-portal/shared-types';
import { MEAL_SLOTS } from '@life-portal/shared-types';
import {
  addDays,
  amountToServings,
  entryTotals,
  servingsToAmount,
} from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { FoodCombobox } from './food-combobox';
import { FoodForm } from './food-form';
import { FoodThumb } from './food-thumb';
import { useAction, useApi } from '../lib/hooks';
import { MealImpact } from './meal-impact';
import { Input, Modal } from './ui';

/**
 * Each meal's icon and colour. The hues sit apart from the macro palette (green, purple, blue,
 * amber) so a meal chip is never mistaken for a nutrient, and they are mid-tones that read on
 * both themes.
 */
const SLOTS: Record<MealSlot, { label: string; icon: LucideIcon; color: string }> = {
  breakfast: { label: 'Breakfast', icon: Sunrise, color: '#f97316' },
  lunch: { label: 'Lunch', icon: Sun, color: '#eab308' },
  dinner: { label: 'Dinner', icon: Moon, color: '#6366f1' },
  snack: { label: 'Snack', icon: Cookie, color: '#ec4899' },
  uncategorized: { label: 'Other', icon: Utensils, color: '#64748b' },
};

/**
 * The one place a meal gets logged, mounted from the dashboard card and from every slot heading.
 *
 * Three details that matter more than they look:
 *
 * 1. **Servings and the base amount stay in sync.** Whichever field is typed in wins, and the
 *    other follows — the stored row is always base units, so a later edit to the food's serving
 *    size cannot change what was eaten.
 * 2. **The preview uses `entryTotals`, the same domain function the API uses to store the row.**
 *    The number shown before saving and the number saved cannot disagree.
 * 3. **The rings show the day after this meal.** They read the same `/nutrition` overview the
 *    Food page reads (one request, shared by SWR), and when correcting an entry its old totals
 *    are taken out first so it is not counted twice.
 */
export function LogFoodModal({
  open,
  onClose,
  foods,
  day,
  today = day,
  slot: initialSlot,
  entry,
  onLogged,
}: {
  open: boolean;
  onClose: () => void;
  foods: FoodWithUsage[];
  day: string;
  /** The eater's today, sent as `?today=` so the day's targets match the Food page. */
  today?: string;
  slot: MealSlot;
  /** Present when correcting an already-logged entry. */
  entry?: MealEntry;
  onLogged?: (entry?: MealEntry) => void;
}) {
  const [addingFood, setAddingFood] = useState<{ name: string } | null>(null);
  const editing = entry != null;
  const { run, pending, error, clearError } = useAction();

  const [slot, setSlot] = useState<MealSlot>(entry?.slot ?? initialSlot);
  const [foodId, setFoodId] = useState<string | undefined>(entry?.foodId);
  const [amountText, setAmountText] = useState(
    entry ? String(entry.amount) : '',
  );
  const [servingsText, setServingsText] = useState(
    entry ? String(entry.servings) : '',
  );
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

  const food = useMemo(
    () => foods.find((row) => row.id === foodId),
    [foods, foodId],
  );
  // When editing, the entry's frozen snapshot is the truth, not the food's current numbers.
  const facts = entry?.facts ?? food;
  const servingSize = entry?.facts.servingSize ?? food?.servingSize ?? 100;
  const unit = entry?.unit ?? food?.unit ?? 'g';

  const amount = Number(amountText);
  const validAmount = Number.isFinite(amount) && amount >= 1;
  const preview =
    facts && validAmount ? entryTotals(Math.round(amount), facts) : undefined;

  const overview = useApi<NutritionOverview>(
    open && entryDay ? `/nutrition?today=${today}&day=${entryDay}` : null,
  );
  const eaten = useMemo(() => {
    const totals = overview.data?.dayTotals.totals;
    if (!totals) return undefined;
    // The day being viewed already contains the entry being corrected.
    return entry && entry.day === entryDay ? subtract(totals, entry.totals) : totals;
  }, [overview.data, entry, entryDay]);

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

  /** Half-serving steps, the size people actually adjust a portion by. */
  const stepServings = (direction: 1 | -1) => {
    const current = Number(servingsText);
    const base = Number.isFinite(current) && current > 0 ? current : 0;
    const next = Math.max(0.5, Math.round((base + direction * 0.5) * 2) / 2);
    setFromServings(String(next));
  };

  const pickFood = (picked: FoodWithUsage) => {
    setFoodId(picked.id);
    // A fresh pick starts at one serving, so the rings show something straight away. A switch
    // keeps the servings already typed and works the amount out for the new serving size.
    const servings = Number(servingsText);
    const keep = Number.isFinite(servings) && servings > 0 ? servings : 1;
    setServingsText(String(keep));
    setAmountText(String(servingsToAmount(keep, picked.servingSize)));
  };

  const submit = () => {
    if (!facts || !validAmount) return;
    let recorded: MealEntry | undefined;
    void run(async () => {
      if (editing) {
        await api.patch(`/nutrition/entries/${entry.id}`, {
          slot,
          day: entryDay,
          amount: Math.round(amount),
        });
      } else {
        recorded = await api.post<MealEntry>('/nutrition/entries', {
          day: entryDay,
          slot,
          foodId,
          amount: Math.round(amount),
        });
      }
    }).then((ok) => {
      if (ok) {
        onLogged?.(recorded);
        onClose();
      }
    });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={editing ? 'Correct a meal' : 'Log food'}
        headerAction={
          <DayPicker day={entryDay} today={today} onChange={setEntryDay} />
        }
        onSubmit={submit}
        submitLabel={editing ? 'Save' : 'Record meal'}
        pending={pending}
        error={error}
        wide
      >
        <MealChooser value={slot} onChange={setSlot} />

        {editing ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
            <FoodThumb
              name={entry.facts.name}
              imageUrl={food?.image?.url}
              macros={entry.totals}
              size={44}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{entry.facts.name}</p>
              <p className="text-xs text-ink-faint">
                Logged at {entry.facts.energyKcalPer100} kcal per 100 {unit}. A
                different food is a different meal.
              </p>
            </div>
          </div>
        ) : (
          <FoodCombobox
            foods={foods}
            selected={food}
            onSelect={pickFood}
            onCreate={(name) => setAddingFood({ name })}
          />
        )}

        {facts && (
          <>
            <div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="label">Servings</span>
                  <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-surface focus-within:border-accent">
                    <StepButton
                      label="Half a serving less"
                      onClick={() => stepServings(-1)}
                    >
                      <Minus size={15} />
                    </StepButton>
                    <Input
                      inputMode="decimal"
                      placeholder="1"
                      value={servingsText}
                      onChange={(event) => setFromServings(event.target.value)}
                      aria-label="Servings"
                      className="min-w-0 rounded-none border-0 text-center tabular focus:border-0"
                    />
                    <StepButton
                      label="Half a serving more"
                      onClick={() => stepServings(1)}
                    >
                      <Plus size={15} />
                    </StepButton>
                  </div>
                </div>
                <div>
                  <span className="label">Amount</span>
                  <div className="relative">
                    <Input
                      inputMode="numeric"
                      placeholder={String(servingSize)}
                      value={amountText}
                      onChange={(event) => setFromAmount(event.target.value)}
                      aria-label={`Amount in ${unit}`}
                      className="pr-9 tabular"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
                      {unit}
                    </span>
                  </div>
                </div>
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                1 serving = {servingSize} {unit} · type either, the other follows
              </p>
              {amount > 3000 && (
                <p className="mt-1 text-xs text-amber-400">
                  {Math.round(amount)} {unit} is a lot — worth a second look in
                  case a digit slipped.
                </p>
              )}
            </div>

            <MealImpact
              eaten={eaten}
              added={preview}
              targets={overview.data?.targets}
              loading={overview.isLoading}
            />
          </>
        )}
      </Modal>
      {addingFood && (
        <FoodForm
          open
          onClose={() => setAddingFood(null)}
          lookupAvailable
          initialName={addingFood.name}
          onSaved={() => setAddingFood(null)}
        />
      )}
    </>
  );
}

function MealChooser({
  value,
  onChange,
}: {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Meal">
      {MEAL_SLOTS.map((option) => {
        const { label, icon: Icon, color } = SLOTS[option];
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={clsx(
              'flex flex-col items-center gap-1 rounded-xl border px-0.5 py-2 text-[10px] font-medium tracking-tight transition active:scale-95 sm:text-[11px]',
              selected ? 'text-ink' : 'border-border text-ink-muted hover:text-ink',
            )}
            style={
              selected
                ? { borderColor: color, backgroundColor: `${color}1f` }
                : undefined
            }
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full transition"
              style={{
                color: selected ? '#fff' : color,
                backgroundColor: selected ? color : `${color}1f`,
              }}
            >
              <Icon size={16} strokeWidth={2.2} />
            </span>
            <span className="max-w-full truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Which day the meal goes on: arrows for the day either side, and the label opens the native date
 * picker. Tomorrow and later are not offered — a meal is logged once it is eaten.
 */
function DayPicker({
  day,
  today,
  onChange,
}: {
  day: string;
  today: string;
  onChange: (day: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const isToday = day === today;
  const label = isToday
    ? 'Today'
    : day === addDays(today, -1)
      ? 'Yesterday'
      : shortDay(day);
  return (
    <div className="flex h-8 items-center rounded-full border border-border bg-surface text-xs">
      <button
        type="button"
        className="flex h-full w-7 items-center justify-center rounded-l-full text-ink-muted hover:text-ink"
        onClick={() => onChange(addDays(day, -1))}
        aria-label="Day before"
      >
        <ChevronLeft size={15} />
      </button>
      <label className="relative flex h-full cursor-pointer items-center px-1 font-medium">
        <span className={clsx(!isToday && 'text-amber-400')}>{label}</span>
        <input
          ref={picker}
          type="date"
          value={day}
          max={today}
          onChange={(event) => event.target.value && onChange(event.target.value)}
          onClick={() => picker.current?.showPicker?.()}
          aria-label="Day"
          // Invisible but on top of the label, so a tap opens the native picker. 16px stops iOS
          // zooming in when it takes focus.
          className="absolute inset-0 cursor-pointer text-[16px] opacity-0"
        />
      </label>
      <button
        type="button"
        className="flex h-full w-7 items-center justify-center rounded-r-full text-ink-muted hover:text-ink disabled:opacity-30"
        onClick={() => onChange(addDays(day, 1))}
        disabled={day >= today}
        aria-label="Day after"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex w-9 shrink-0 items-center justify-center text-ink-muted transition hover:bg-surface-raised hover:text-ink active:scale-90"
    >
      {children}
    </button>
  );
}

/** `Wed 5 Nov`, for a day that is neither today nor yesterday. */
function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function subtract(a: EntryTotals, b: EntryTotals): EntryTotals {
  return {
    energyKcal: Math.max(0, a.energyKcal - b.energyKcal),
    proteinMg: Math.max(0, a.proteinMg - b.proteinMg),
    carbMg: Math.max(0, a.carbMg - b.carbMg),
    fatMg: Math.max(0, a.fatMg - b.fatMg),
  };
}
