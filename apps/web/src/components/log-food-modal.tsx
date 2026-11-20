'use client';

import clsx from 'clsx';
import { withAlpha } from '../lib/macro-colors';
import {
  ChevronLeft,
  ChevronRight,
  Cookie,
  Minus,
  Moon,
  Plus,
  Sparkles,
  Sun,
  Sunrise,
  Utensils,
  type LucideIcon,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  EntryTotals,
  FoodWithUsage,
  MealEntry,
  MealSlot,
  MealSuggestion,
} from '@life-portal/shared-types';
import { MEAL_SLOTS } from '@life-portal/shared-types';
import {
  addDays,
  amountToServings,
  entryTotals,
  servingsToAmount,
} from '@life-portal/shared-domain';
import { foodWrites, useNutritionDay } from '../lib/nutrition-offline';
import { FoodCombobox } from './food-combobox';
import { FoodForm } from './food-form';
import { FoodThumb } from './food-thumb';
import { useAction } from '../lib/hooks';
import { MacroSplit } from './macro-split';
import { MealImpact } from './meal-impact';
import { Input, Modal } from './ui';

/**
 * Each meal's icon and colour. The hues sit apart from the macro palette (green, purple, blue,
 * amber) so a meal chip is never mistaken for a nutrient, and they are mid-tones that read on
 * both themes.
 */
const SLOTS: Record<MealSlot, { label: string; icon: LucideIcon; color: string }> = {
  // The same colour per meal as the Food page (`SLOT_STYLES`), as roles.
  breakfast: { label: 'Breakfast', icon: Sunrise, color: 'rgb(var(--train-core-solid))' },
  lunch: { label: 'Lunch', icon: Sun, color: 'rgb(var(--train-legs-solid))' },
  dinner: { label: 'Dinner', icon: Moon, color: 'rgb(var(--train-arms-solid))' },
  snack: { label: 'Snack', icon: Cookie, color: 'rgb(var(--train-cardio-solid))' },
  uncategorized: { label: 'Other', icon: Utensils, color: 'rgb(var(--train-pull-solid))' },
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
  food: initialFood,
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
  /** Start with this food chosen, at one serving (logging straight from the food list). */
  food?: FoodWithUsage;
  onLogged?: (entry?: MealEntry) => void;
}) {
  const [addingFood, setAddingFood] = useState<{ name: string } | null>(null);
  const editing = entry != null;
  const { run, pending, error, clearError } = useAction();

  const [slot, setSlot] = useState<MealSlot>(entry?.slot ?? initialSlot);
  const [foodId, setFoodId] = useState<string | undefined>(entry?.foodId ?? initialFood?.id);
  const [amountText, setAmountText] = useState(
    entry ? String(entry.amount) : initialFood ? String(initialFood.servingSize) : '',
  );
  const [servingsText, setServingsText] = useState(
    entry ? String(entry.servings) : initialFood ? '1' : '',
  );
  const [entryDay, setEntryDay] = useState(entry?.day ?? day);
  // Foods already chosen in this sheet and waiting to be recorded with the rest: each keeps the
  // meal and amount it was added with. Recorded together by the one button at the end.
  const [basket, setBasket] = useState<Waiting[]>([]);

  // Reopening for a different slot, day or entry must not show the last one's numbers.
  useEffect(() => {
    if (!open) return;
    clearError();
    setSlot(entry?.slot ?? initialSlot);
    setFoodId(entry?.foodId ?? initialFood?.id);
    setEntryDay(entry?.day ?? day);
    setBasket([]);
    setAmountText(entry ? String(entry.amount) : initialFood ? String(initialFood.servingSize) : '');
    setServingsText(entry ? String(entry.servings) : initialFood ? '1' : '');
    // `initialFood` by id: the list re-creates the object on every read.
  }, [open, entry, initialSlot, day, clearError, initialFood?.id]);

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

  // Spec 029: the day as this device has it, meals still waiting to be sent included.
  const overview = useNutritionDay(
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

  /** A suggestion fills in its food and the amount eaten last time; the person still records it. */
  const pickSuggestion = (picked: FoodWithUsage, suggestion: MealSuggestion) => {
    setFoodId(picked.id);
    setAmountText(String(suggestion.amount));
    setServingsText(String(amountToServings(suggestion.amount, picked.servingSize)));
  };
  // What this meal has had before (the same list the Food page shows under the meal), for the
  // meal now chosen. Only foods this device has: the rest cannot be logged from here.
  const suggested = useMemo(
    () =>
      (overview.data?.suggestions ?? [])
        .filter((suggestion) => suggestion.slot === slot)
        .flatMap((suggestion) => {
          const match = foods.find((row) => row.id === suggestion.foodId);
          return match ? [{ suggestion, food: match }] : [];
        }),
    [overview.data?.suggestions, slot, foods],
  );

  /** The food being set up now, as something that can wait: only once it has a food and an amount. */
  const current: Waiting | undefined =
    !editing && food && validAmount ? { key: `${food.id}:${slot}:${Date.now()}`, food, slot, amount: Math.round(amount) } : undefined;
  const waitingTotals = basket.reduce<EntryTotals | undefined>(
    (sum, item) => plus(sum, entryTotals(item.amount, item.food)),
    undefined,
  );

  /** Keeps the current food for later and clears the form for the next one. */
  const addAnother = () => {
    if (!current) return;
    setBasket((items) => [...items, current]);
    setFoodId(undefined);
    setAmountText('');
    setServingsText('');
    clearError();
  };
  /** Brings a waiting food back into the form; whatever was being set up waits in its place. */
  const reopen = (item: Waiting) => {
    setBasket((items) => [...items.filter((other) => other.key !== item.key), ...(current ? [current] : [])]);
    setSlot(item.slot);
    setFoodId(item.food.id);
    setAmountText(String(item.amount));
    setServingsText(String(amountToServings(item.amount, item.food.servingSize)));
  };
  // Closing with foods waiting would lose them, so it asks first.
  const requestClose = () => {
    if (basket.length && !window.confirm(`Discard the ${basket.length} food${basket.length === 1 ? '' : 's'} you added?`)) return;
    onClose();
  };
  const toRecord = [...basket, ...(current ? [current] : [])];

  const submit = () => {
    if (!editing) {
      if (!toRecord.length) return;
      let last: MealEntry | undefined;
      // One after another: each is kept on the device at once and sent when there is a connection
      // (spec 029), so a dropped connection midway loses nothing.
      void run(async () => {
        for (const item of toRecord) last = await foodWrites.logEntry(item.food, { day: entryDay, slot: item.slot, amount: item.amount });
      }, { revalidate: false }).then((ok) => {
        if (ok) {
          setBasket([]);
          onLogged?.(last);
          onClose();
        }
      });
      return;
    }
    if (!facts || !validAmount) return;
    let recorded: MealEntry | undefined;
    // Spec 029: kept on the device and shown at once (marked "not saved yet" until the server
    // has it); sent when there is a connection. The server still snapshots the food itself.
    void run(async () => {
      if (editing) {
        await foodWrites.updateEntry(entry, {
          slot,
          day: entryDay,
          amount: Math.round(amount),
        });
      } else if (food) {
        recorded = await foodWrites.logEntry(food, {
          day: entryDay,
          slot,
          amount: Math.round(amount),
        });
      }
    }, { revalidate: false }).then((ok) => {
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
        onClose={requestClose}
        title={editing ? 'Correct a meal' : 'Log food'}
        headerAction={
          <DayPicker day={entryDay} today={today} onChange={setEntryDay} />
        }
        onSubmit={submit}
        submitLabel={editing ? 'Save' : toRecord.length > 1 ? `Record ${toRecord.length} foods` : 'Record meal'}
        pending={pending}
        error={error}
        wide
      >
        <MealChooser value={slot} onChange={setSlot} waiting={basket} />

        {/* Foods already added in this sheet, one line each: tap to change, × to drop. */}
        {basket.length > 0 && (
          <ul className="space-y-1" aria-label="Foods added">
            {basket.map((item) => {
              const totals = entryTotals(item.amount, item.food);
              const { label, color } = SLOTS[item.slot];
              return (
                <li key={item.key} className="flex items-center gap-2 rounded-xl border border-border bg-surface pl-2.5 pr-1 text-sm">
                  <span className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                  <button type="button" onClick={() => reopen(item)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left" aria-label={`Change ${item.food.name}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.food.name}</span>
                      <span className="block truncate text-xs text-ink-faint">
                        {item.amount} {item.food.unit} · {label}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-xs font-semibold">
                      {totals.energyKcal}
                      <span className="ml-0.5 font-normal text-ink-faint">kcal</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:text-danger"
                    aria-label={`Remove ${item.food.name}`}
                    onClick={() => setBasket((items) => items.filter((other) => other.key !== item.key))}
                  >
                    <X size={15} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {editing ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
            <FoodThumb
              name={entry.facts.name}
              imageUrl={food?.image?.url}
              brand={entry.facts.brand}
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

        {/* Before a food is chosen: what this meal usually is, one tap to fill in. */}
        {!editing && !food && suggested.length > 0 && (
          <div>
            <p className="label flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> {slot === 'uncategorized' ? 'From your recent meals' : `From your recent ${SLOTS[slot].label.toLowerCase()}`}
            </p>
            <ul className="space-y-0.5">
              {suggested.map(({ suggestion, food: item }) => (
                <li key={suggestion.foodId}>
                  <button
                    type="button"
                    onClick={() => pickSuggestion(item, suggestion)}
                    aria-label={`Choose ${suggestion.name}, ${suggestion.amount} ${suggestion.unit}`}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface active:scale-[0.99]"
                  >
                    <FoodThumb name={item.name} imageUrl={item.image?.url} brand={item.brand} macros={item.perServing} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{suggestion.name}</span>
                      <span className="tabular block truncate text-xs text-ink-faint">
                        {suggestion.amount} {suggestion.unit}
                        {suggestion.dayCount > 1 && ` · ${suggestion.dayCount} days`}
                      </span>
                    </span>
                    <span className="w-16 shrink-0 text-right">
                      <span className="tabular block text-sm font-medium text-ink">
                        {suggestion.totals.energyKcal}
                        <span className="ml-0.5 text-[10px] font-normal text-ink-faint">kcal</span>
                      </span>
                      <MacroSplit macros={suggestion.totals} thin className="mt-1" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
                <p className="mt-1 text-xs text-warning">
                  {Math.round(amount)} {unit} is a lot — worth a second look in
                  case a digit slipped.
                </p>
              )}
            </div>

            <MealImpact
              eaten={eaten}
              added={plus(waitingTotals, preview)}
              targets={overview.data?.targets}
              loading={overview.isLoading}
            />
            {current && (
              <button type="button" className="btn-ghost w-full justify-center" onClick={addAnother}>
                <Plus size={15} aria-hidden /> Add another food
              </button>
            )}
          </>
        )}
        {/* Nothing being set up, but foods waiting: the rings still show the day with them. */}
        {!facts && waitingTotals && (
          <MealImpact eaten={eaten} added={waitingTotals} targets={overview.data?.targets} loading={overview.isLoading} />
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
  waiting = [],
}: {
  value: MealSlot;
  onChange: (slot: MealSlot) => void;
  /** Foods added and not yet recorded: each meal shows how many it holds. */
  waiting?: readonly Waiting[];
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
              'relative flex flex-col items-center gap-1 rounded-xl border px-0.5 py-2 text-[10px] font-medium tracking-tight transition active:scale-95 sm:text-[11px]',
              selected ? 'text-ink' : 'border-border text-ink-muted hover:text-ink',
            )}
            style={
              selected
                ? { borderColor: color, backgroundColor: withAlpha(color, 0.12) }
                : undefined
            }
          >
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full transition"
              style={{
                color: selected ? '#fff' : color,
                backgroundColor: selected ? color : withAlpha(color, 0.12),
              }}
            >
              <Icon size={16} strokeWidth={2.2} />
            </span>
            <span className="max-w-full truncate">{label}</span>
            {waiting.some((item) => item.slot === option) && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold leading-none text-surface"
                aria-label={`${waiting.filter((item) => item.slot === option).length} added`}
              >
                {waiting.filter((item) => item.slot === option).length}
              </span>
            )}
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
        <span className={clsx(!isToday && 'text-warning')}>{label}</span>
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

/** A food added in the sheet and waiting to be recorded. */
interface Waiting {
  key: string;
  food: FoodWithUsage;
  slot: MealSlot;
  amount: number;
}

/** Two totals added; either may be missing. */
function plus(a: EntryTotals | undefined, b: EntryTotals | undefined): EntryTotals | undefined {
  if (!a || !b) return a ?? b;
  return {
    energyKcal: a.energyKcal + b.energyKcal,
    proteinMg: a.proteinMg + b.proteinMg,
    carbMg: a.carbMg + b.carbMg,
    fatMg: a.fatMg + b.fatMg,
  };
}

function subtract(a: EntryTotals, b: EntryTotals): EntryTotals {
  return {
    energyKcal: Math.max(0, a.energyKcal - b.energyKcal),
    proteinMg: Math.max(0, a.proteinMg - b.proteinMg),
    carbMg: Math.max(0, a.carbMg - b.carbMg),
    fatMg: Math.max(0, a.fatMg - b.fatMg),
  };
}
