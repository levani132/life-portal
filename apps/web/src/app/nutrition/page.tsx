'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import type {
  Estimate,
  Food,
  MealEntry,
  MealSlot,
  NutritionOverview,
  NutritionTargets,
  SavedMeal,
  SlotTotals,
  TargetFigure,
} from '@life-portal/shared-types';
import {
  ACTIVITY_LABELS,
  addDays,
  figureValue,
  formatDay,
  GOAL_PLAN,
  isRecorded,
  mgToG,
  relativeDays,
} from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import { CheatQueue } from '../../components/cheat-queue';
import { FoodForm } from '../../components/food-form';
import { FoodPicker } from '../../components/food-picker';
import { LogFoodModal } from '../../components/log-food-modal';
import { NutritionSettings } from '../../components/nutrition-settings';
import {
  Chip,
  EmptyState,
  ErrorNote,
  EstimateMark,
  Field,
  Input,
  Modal,
  Panel,
  ProgressBar,
  Spinner,
} from '../../components/ui';
import { WeekBalancePanel } from '../../components/week-balance';
import { WeighInPanel } from '../../components/weigh-in-panel';
import { WeightTrend } from '../../components/weight-trend';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import { mealContextNow } from '../../lib/local-day';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
  uncategorized: 'Anything else',
};

const MISSING_INPUT_LABELS: Record<string, string> = {
  sex: 'your sex',
  heightCm: 'your height',
  birthDate: 'your date of birth',
  weighIn: 'a weigh-in',
};

type Tab = 'today' | 'foods' | 'you';

export default function NutritionPage() {
  return (
    <AppShell>
      <Nutrition />
    </AppShell>
  );
}

function Nutrition() {
  // The day is the eater's, not the server's, so it is resolved on the client after mount —
  // computing it during render would disagree with the server's HTML.
  const [dayStartHour, setDayStartHour] = useState(4);
  const [today, setToday] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [logging, setLogging] = useState<{ slot: MealSlot; entry?: MealEntry } | null>(null);

  useEffect(() => {
    const context = mealContextNow(dayStartHour);
    setToday(context.day);
    setDay((current) => current ?? context.day);
  }, [dayStartHour]);

  const key = today && day ? `/nutrition?today=${today}&day=${day}` : null;
  const { data, error, isLoading, mutate } = useApi<NutritionOverview>(key);

  // The profile decides when a day starts, which decides which day this is. One correction.
  useEffect(() => {
    if (data && data.profile.dayStartHour !== dayStartHour) setDayStartHour(data.profile.dayStartHour);
  }, [data, dayStartHour]);

  if (isLoading || !today || !day) return <Spinner label="Adding up today…" />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { targets, dayTotals, profile } = data;
  const viewingToday = day === today;
  const refresh = () => void mutate();

  return (
    <>
      <PageHeader
        title="Food"
        subtitle={
          targets.available
            ? `${GOAL_PLAN[profile.goal].label} · ${ACTIVITY_LABELS[profile.activityLevel]}`
            : 'Targets need a few numbers about you'
        }
        actions={
          <>
            <div className="flex items-center gap-1 rounded-lg border border-border p-1 text-sm">
              {(['today', 'foods', 'you'] as Tab[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTab(option)}
                  className={clsx(
                    'rounded-md px-2.5 py-1',
                    tab === option ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {option === 'today' ? 'Today' : option === 'foods' ? 'Foods' : 'You'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setLogging({ slot: mealContextNow(dayStartHour).slot })}
            >
              + Log food
            </button>
          </>
        }
      />

      {tab === 'today' && (
        <div className="space-y-5">
          <DayNavigator
            day={day}
            today={today}
            onChange={setDay}
            entryCount={dayTotals.entryCount}
          />

          <MacroTiles totals={dayTotals.totals} targets={targets} />

          {!targets.available && <MissingInputs targets={targets} onFix={() => setTab('you')} />}

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              {dayTotals.slots.map((slot) => (
                <SlotSection
                  key={slot.slot}
                  slot={slot}
                  day={day}
                  onAdd={() => setLogging({ slot: slot.slot })}
                  onEdit={(entry) => setLogging({ slot: entry.slot, entry })}
                  onChanged={refresh}
                />
              ))}
              {!viewingToday && (
                <p className="text-xs text-ink-faint">
                  You are looking at {formatDay(day)}, {relativeDays(today, day)}. Anything logged
                  here lands on that day.
                </p>
              )}
            </div>

            <div className="space-y-5">
              <WeekBalancePanel week={data.week} />
              <CheatSection overview={data} today={today} onChanged={refresh} />
              <RepeatPanel overview={data} day={day} onChanged={refresh} />
            </div>
          </div>
        </div>
      )}

      {tab === 'foods' && <FoodsTab overview={data} onChanged={refresh} />}

      {tab === 'you' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            {/* Keyed on the server's own version, so a real change re-seeds the form and an
                ordinary refetch does not (see the note in NutritionSettings). */}
            <NutritionSettings key={profile.updatedAt} profile={profile} onSaved={refresh} />
            <WeighInPanel weighIns={data.weighIns} today={today} onSaved={refresh} />
          </div>
          <div className="space-y-5">
            <TargetsPanel targets={targets} />
            <WeightTrend weighIns={data.weighIns} />
          </div>
        </div>
      )}

      {logging && (
        <LogFoodModal
          open
          onClose={() => setLogging(null)}
          foods={data.foods}
          day={day}
          slot={logging.slot}
          entry={logging.entry}
          onLogged={refresh}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ today

function DayNavigator({
  day,
  today,
  onChange,
  entryCount,
}: {
  day: string;
  today: string;
  onChange: (day: string) => void;
  entryCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => onChange(addDays(day, -1))}
          aria-label="Previous day"
        >
          ←
        </button>
        <div className="text-center">
          <p className="text-sm font-medium">{formatDay(day)}</p>
          <p className="text-xs text-ink-faint">
            {day === today ? 'today' : relativeDays(today, day)} ·{' '}
            {entryCount === 0 ? 'nothing logged' : `${entryCount} logged`}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => onChange(addDays(day, 1))}
          disabled={day >= today}
          aria-label="Next day"
        >
          →
        </button>
      </div>
      {day !== today && (
        <button type="button" className="btn-ghost" onClick={() => onChange(today)}>
          Back to today
        </button>
      )}
    </div>
  );
}

function MacroTiles({
  totals,
  targets,
}: {
  totals: SlotTotals['totals'];
  targets: NutritionTargets;
}) {
  const tiles = [
    {
      label: 'Calories',
      eaten: totals.energyKcal,
      target: figureValue(targets.energyKcal),
      unit: 'kcal',
      figure: targets.energyKcal,
    },
    {
      label: 'Protein',
      eaten: mgToG(totals.proteinMg),
      target: figureValue(targets.proteinG),
      unit: 'g',
      figure: targets.proteinG,
    },
    {
      label: 'Carbs',
      eaten: mgToG(totals.carbMg),
      target: figureValue(targets.carbG),
      unit: 'g',
      figure: targets.carbG,
    },
    {
      label: 'Fat',
      eaten: mgToG(totals.fatMg),
      target: figureValue(targets.fatG),
      unit: 'g',
      figure: targets.fatG,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => {
        const left = tile.target != null ? tile.target - tile.eaten : undefined;
        const over = left != null && left < 0;
        return (
          <div key={tile.label} className="card p-4">
            <div className="flex items-baseline justify-between">
              <p className="label mb-0">{tile.label}</p>
              {tile.figure && !isRecorded(tile.figure) && (
                <EstimateMark basis={(tile.figure as Estimate<number>).basis} />
              )}
            </div>
            <p className="tabular mt-1 text-2xl font-semibold">
              {tile.eaten.toLocaleString()}{' '}
              {/* Target and unit travel together, so a narrow tile wraps them as one phrase. */}
              <span className="whitespace-nowrap text-sm font-normal text-ink-faint">
                {tile.target != null && `/ ${tile.target.toLocaleString()} `}
                <span className="text-xs">{tile.unit}</span>
              </span>
            </p>
            <p className={clsx('mt-0.5 text-xs', over ? 'text-rose-400' : 'text-ink-faint')}>
              {left == null
                ? 'no target yet'
                : over
                  ? `${Math.abs(left).toLocaleString()} ${tile.unit} over`
                  : `${left.toLocaleString()} ${tile.unit} left`}
            </p>
            {tile.target != null && tile.target > 0 && (
              <div className="mt-2">
                <ProgressBar
                  ratio={tile.eaten / tile.target}
                  tone={over ? 'bad' : tile.eaten / tile.target > 0.9 ? 'warn' : 'good'}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MissingInputs({ targets, onFix }: { targets: NutritionTargets; onFix: () => void }) {
  const missing = targets.missingInputs.map((input) => MISSING_INPUT_LABELS[input] ?? input);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <p>
        No targets yet — they need {missing.join(', ')}. Logging still works; it just cannot tell
        you what is left.
      </p>
      <button type="button" className="btn-ghost shrink-0" onClick={onFix}>
        Fill it in
      </button>
    </div>
  );
}

function SlotSection({
  slot,
  day,
  onAdd,
  onEdit,
  onChanged,
}: {
  slot: SlotTotals;
  day: string;
  onAdd: () => void;
  onEdit: (entry: MealEntry) => void;
  onChanged: () => void;
}) {
  const { run, pending } = useAction();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const remove = (id: string) =>
    void run(async () => api.delete(`/nutrition/entries/${id}`)).then((ok) => {
      if (ok) onChanged();
    });

  const saveAsMeal = () =>
    void run(async () =>
      api.post('/nutrition/meals/from-day', { name: name.trim(), day, slot: slot.slot }),
    ).then((ok) => {
      if (ok) {
        setSaving(false);
        setName('');
        onChanged();
      }
    });

  return (
    <Panel
      title={SLOT_LABELS[slot.slot]}
      description={
        slot.entries.length === 0
          ? undefined
          : `${slot.totals.energyKcal} kcal · P ${mgToG(slot.totals.proteinMg)}g · C ${mgToG(slot.totals.carbMg)}g · F ${mgToG(slot.totals.fatMg)}g`
      }
      actions={
        <>
          {slot.entries.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setSaving(true)}
              title="Save this as a meal you can log in one tap"
            >
              Save as meal
            </button>
          )}
          <button
            type="button"
            className="btn-ghost px-3.5 text-lg leading-none active:scale-95"
            onClick={onAdd}
            aria-label={`Add to ${SLOT_LABELS[slot.slot]}`}
          >
            +
          </button>
        </>
      }
    >
      {slot.entries.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {slot.entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate">
                  {entry.facts.name}
                  {entry.facts.brand && (
                    <span className="ml-1 text-xs text-ink-faint">{entry.facts.brand}</span>
                  )}
                </p>
                <p className="text-xs text-ink-faint">
                  {entry.amount} {entry.unit}
                  {entry.servings > 0 &&
                    ` · ${entry.servings} serving${entry.servings === 1 ? '' : 's'}`}
                  {' · P '}
                  {mgToG(entry.totals.proteinMg)}g C {mgToG(entry.totals.carbMg)}g F{' '}
                  {mgToG(entry.totals.fatMg)}g
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="tabular text-ink-muted">{entry.totals.energyKcal} kcal</span>
                <button
                  type="button"
                  className="text-xs text-ink-faint hover:text-ink"
                  onClick={() => onEdit(entry)}
                >
                  edit
                </button>
                <button
                  type="button"
                  className="p-1 text-xs text-ink-faint hover:text-rose-300"
                  onClick={() => remove(entry.id)}
                  disabled={pending}
                  aria-label={`Remove ${entry.facts.name}`}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={saving}
        onClose={() => setSaving(false)}
        title={`Save ${SLOT_LABELS[slot.slot].toLowerCase()} as a meal`}
        onSubmit={saveAsMeal}
        submitLabel="Save meal"
        pending={pending}
      >
        <Field label="Call it" hint="e.g. my oatmeal bowl">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <p className="text-xs text-ink-faint">
          Saves the {slot.entries.length} item{slot.entries.length === 1 ? '' : 's'} and their
          amounts. Logging it later uses whatever those foods say then.
        </p>
      </Modal>
    </Panel>
  );
}

// ------------------------------------------------------------------ cheat day

function CheatSection({
  overview,
  today,
  onChanged,
}: {
  overview: NutritionOverview;
  today: string;
  onChanged: () => void;
}) {
  const { cheat, foods, profile } = overview;
  const [adding, setAdding] = useState(false);
  const [foodId, setFoodId] = useState<string | undefined>();
  const [amount, setAmount] = useState('');
  const { run, pending } = useAction();

  const selected = foods.find((food) => food.id === foodId);

  const add = () =>
    void run(async () =>
      api.post('/nutrition/cheat', {
        foodId,
        amount: Math.max(1, Math.round(Number(amount) || selected?.servingSize || 100)),
      }),
    ).then((ok) => {
      if (ok) {
        setAdding(false);
        setFoodId(undefined);
        setAmount('');
        onChanged();
      }
    });

  const countdown =
    cheat.daysUntil == null
      ? undefined
      : cheat.isToday
        ? 'today — enjoy it'
        : cheat.daysUntil === 1
          ? 'tomorrow'
          : `in ${cheat.daysUntil} days`;

  return (
    <Panel
      title="Cheat day"
      description={
        cheat.nextDay
          ? `${formatDay(cheat.nextDay)}, ${countdown}`
          : 'No cheat day set. One is worth setting — a diet with no release valve does not last.'
      }
      actions={
        <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>
          + Queue
        </button>
      }
    >
      {cheat.queue.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <Chip tone="neutral">queued: {cheat.queueTotals.energyKcal.toLocaleString()} kcal</Chip>
          {cheat.bankedKcal > 0 && (
            <Chip tone="good">{cheat.bankedKcal.toLocaleString()} kcal banked</Chip>
          )}
        </div>
      )}

      <CheatQueue
        queue={cheat.queue}
        canLog={cheat.isToday}
        logDay={today}
        logSlot="uncategorized"
        onChanged={onChanged}
      />

      {!cheat.isToday && cheat.queue.some((row) => !row.eaten) && (
        <p className="mt-3 text-xs text-ink-faint">
          &ldquo;Log it&rdquo; appears on the day itself. Until then this is a list, in the order
          you want it.
        </p>
      )}

      {profile.cheatDays.length === 0 && cheat.queue.length > 0 && (
        <p className="mt-3 text-xs text-amber-400">
          Set a cheat day under &ldquo;You&rdquo; and this list gets a date.
        </p>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Queue something for the cheat day"
        onSubmit={add}
        submitLabel="Add to queue"
        pending={pending}
        wide
      >
        <Field label="Food">
          <FoodPicker
            foods={foods}
            selectedId={foodId}
            onSelect={(food) => {
              setFoodId(food.id);
              setAmount(String(food.servingSize));
            }}
          />
        </Field>
        {selected && (
          <Field
            label={`How much (${selected.unit})`}
            hint={`1 serving = ${selected.servingSize} ${selected.unit}`}
          >
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
        )}
      </Modal>
    </Panel>
  );
}

function RepeatPanel({
  overview,
  day,
  onChanged,
}: {
  overview: NutritionOverview;
  day: string;
  onChanged: () => void;
}) {
  const { run, pending } = useAction();
  const meals = overview.recentMeals.filter((meal) => meal.day !== day);

  if (meals.length === 0 && overview.savedMeals.length === 0) return null;

  const repeat = (sourceDay: string, slot: MealSlot) =>
    void run(async () =>
      api.post('/nutrition/entries/repeat', { sourceDay, sourceSlot: slot, day, slot }),
    ).then((ok) => {
      if (ok) onChanged();
    });

  const logMeal = (meal: SavedMeal) =>
    void run(async () =>
      api.post(`/nutrition/meals/${meal.id}/log`, {
        day,
        slot: meal.defaultSlot ?? 'uncategorized',
      }),
    ).then((ok) => {
      if (ok) onChanged();
    });

  return (
    <Panel title="Log it again" description="The same thing, on this day, in one tap.">
      {overview.savedMeals.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {overview.savedMeals.map((meal) => (
            <li key={meal.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                {meal.name}
                <span className="ml-1 text-xs text-ink-faint">
                  {meal.totals.energyKcal} kcal · {meal.components.length} items
                </span>
              </span>
              <button
                type="button"
                className="btn-ghost shrink-0"
                onClick={() => logMeal(meal)}
                disabled={pending || !meal.loggable}
                title={meal.loggable ? undefined : 'One of its foods is gone — fix it under Foods'}
              >
                Log
              </button>
            </li>
          ))}
        </ul>
      )}

      {meals.length > 0 && (
        <ul className="space-y-1.5 border-t border-border pt-3">
          {meals.slice(0, 5).map((meal) => (
            <li
              key={`${meal.day}-${meal.slot}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="min-w-0 truncate text-ink-muted">
                {SLOT_LABELS[meal.slot]}, {formatDay(meal.day)}
                <span className="ml-1 text-xs text-ink-faint">{meal.totals.energyKcal} kcal</span>
              </span>
              <button
                type="button"
                className="btn-ghost shrink-0"
                onClick={() => repeat(meal.day, meal.slot)}
                disabled={pending}
              >
                Repeat
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ foods tab

function FoodsTab({
  overview,
  onChanged,
}: {
  overview: NutritionOverview;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Food | null>(null);
  const [adding, setAdding] = useState(false);
  const { run, pending } = useAction();

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return overview.foods.filter((food) => {
      if (!showArchived && food.archived) return false;
      if (!needle) return true;
      return `${food.name} ${food.brand ?? ''}`.toLowerCase().includes(needle);
    });
  }, [overview.foods, query, showArchived]);

  const toggleFavourite = (food: Food) =>
    void run(async () =>
      api.patch(`/nutrition/foods/${food.id}`, { favourite: !food.favourite }),
    ).then((ok) => {
      if (ok) onChanged();
    });

  const remove = (food: Food) =>
    void run(async () => api.delete(`/nutrition/foods/${food.id}`)).then((ok) => {
      if (ok) onChanged();
    });

  return (
    <div className="space-y-5">
      <Panel
        title="Your foods"
        description={`${overview.foods.length} in your database, ordered by what you actually eat`}
        actions={
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            Add a food
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Input
            type="search"
            placeholder="Search by name or brand…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-xs"
          />
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              className="h-4 w-4 rounded border-border bg-surface"
            />
            include archived
          </label>
          {!overview.foodLookup.available && (
            <span className="text-xs text-amber-400">
              Open Food Facts is unavailable — manual entry works as normal
            </span>
          )}
        </div>

        {shown.length === 0 ? (
          <EmptyState
            message={
              overview.foods.length === 0
                ? 'Nothing here yet. Add the ten things you eat most and the rest takes care of itself.'
                : 'Nothing matching that.'
            }
            action={
              <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
                Add a food
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((food) => (
              <li key={food.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate">
                    <button
                      type="button"
                      onClick={() => toggleFavourite(food)}
                      className={clsx(
                        'mr-1.5',
                        food.favourite ? 'text-amber-400' : 'text-ink-faint',
                      )}
                      aria-label={food.favourite ? 'Remove from favourites' : 'Add to favourites'}
                      disabled={pending}
                    >
                      ★
                    </button>
                    {food.name}
                    {food.brand && <span className="ml-1 text-xs text-ink-faint">{food.brand}</span>}
                    {food.archived && (
                      <span className="ml-2 text-xs text-ink-faint">(archived)</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {food.servingSize} {food.unit} serving · {food.perServing.energyKcal} kcal · P{' '}
                    {mgToG(food.perServing.proteinMg)}g C {mgToG(food.perServing.carbMg)}g F{' '}
                    {mgToG(food.perServing.fatMg)}g
                    {food.useCount > 0 && ` · eaten ${food.useCount}×`}
                    {food.source === 'openfoodfacts' && ' · imported'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    className="text-xs text-ink-faint hover:text-ink"
                    onClick={() => setEditing(food)}
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    className="p-1 text-xs text-ink-faint hover:text-rose-300"
                    onClick={() => remove(food)}
                    disabled={pending}
                    aria-label={`Delete ${food.name}`}
                    title="A food you have eaten is archived, so your history keeps its numbers"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SavedMealsPanel overview={overview} onChanged={onChanged} />

      <FoodForm
        open={adding}
        onClose={() => setAdding(false)}
        lookupAvailable={overview.foodLookup.available}
        lookupReason={overview.foodLookup.reason}
        onSaved={onChanged}
      />
      {editing && (
        <FoodForm
          open
          onClose={() => setEditing(null)}
          food={editing}
          lookupAvailable={overview.foodLookup.available}
          lookupReason={overview.foodLookup.reason}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

function SavedMealsPanel({
  overview,
  onChanged,
}: {
  overview: NutritionOverview;
  onChanged: () => void;
}) {
  const { run, pending } = useAction();

  const remove = (id: string) =>
    void run(async () => api.delete(`/nutrition/meals/${id}`)).then((ok) => {
      if (ok) onChanged();
    });

  return (
    <Panel
      title="Saved meals"
      description="Groups of foods you log together. Build one by logging a meal and saving the slot."
    >
      {overview.savedMeals.length === 0 ? (
        <EmptyState message="None yet. Log a breakfast you repeat, then use “Save as meal” on it." />
      ) : (
        <ul className="divide-y divide-border">
          {overview.savedMeals.map((meal) => (
            <li key={meal.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate">
                  {meal.name}
                  <span className="ml-2 text-xs text-ink-faint">
                    {meal.totals.energyKcal} kcal · P {mgToG(meal.totals.proteinMg)}g
                  </span>
                </p>
                <button
                  type="button"
                  className="p-1 text-xs text-ink-faint hover:text-rose-300"
                  onClick={() => remove(meal.id)}
                  disabled={pending}
                  aria-label={`Delete ${meal.name}`}
                >
                  ✕
                </button>
              </div>
              <p className="mt-0.5 text-xs text-ink-faint">
                {meal.components
                  .map((component) =>
                    component.missing
                      ? 'a food that no longer exists'
                      : `${component.name} ${component.amount}${component.unit ?? ''}`,
                  )
                  .join(' + ')}
              </p>
              {!meal.loggable && (
                <p className="mt-1 text-xs text-amber-400">
                  One of its foods is gone, so this cannot be logged until it is fixed.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ targets

function TargetsPanel({ targets }: { targets: NutritionTargets }) {
  if (!targets.available) {
    const missing = targets.missingInputs.map((input) => MISSING_INPUT_LABELS[input] ?? input);
    return (
      <Panel title="Your targets">
        <p className="text-sm text-ink-muted">
          {missing.length > 0
            ? `Still missing ${missing.join(', ')}. Fill that in on the left and every target appears here with the equation behind it.`
            : 'Fill in the numbers on the left and the targets appear here, each one showing how it was worked out.'}
        </p>
      </Panel>
    );
  }

  const rows: { label: string; figure?: TargetFigure; unit: string }[] = [
    { label: 'Basal rate', figure: targets.bmr, unit: 'kcal' },
    { label: 'Maintenance', figure: targets.tdee, unit: 'kcal' },
    { label: 'Daily calories', figure: targets.energyKcal, unit: 'kcal' },
    { label: 'Protein', figure: targets.proteinG, unit: 'g' },
    { label: 'Carbs', figure: targets.carbG, unit: 'g' },
    { label: 'Fat', figure: targets.fatG, unit: 'g' },
    { label: 'Fibre', figure: targets.fibreG, unit: 'g' },
  ];

  return (
    <Panel
      title="Your targets"
      description="Every figure says where it came from. Hover the mark to see the equation and its inputs."
    >
      <dl className="divide-y divide-border">
        {rows.map((row) =>
          row.figure == null ? null : (
            <div key={row.label} className="flex items-baseline justify-between gap-3 py-2">
              <dt className="text-sm text-ink-muted">
                {row.label}
                {isRecorded(row.figure) ? (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                    yours
                  </span>
                ) : (
                  <EstimateMark basis={(row.figure as Estimate<number>).basis} />
                )}
              </dt>
              <dd className="tabular text-sm font-semibold">
                {row.figure.value.toLocaleString()}
                <span className="ml-1 text-xs font-normal text-ink-faint">{row.unit}</span>
              </dd>
            </div>
          ),
        )}
      </dl>

      <div className="mt-3 space-y-2 text-xs">
        {targets.bodyFatRecordedPct != null ? (
          <p className="text-ink-faint">
            Using your recorded body fat of {Math.round(targets.bodyFatRecordedPct * 1000) / 10}%,
            so protein and fat are set against lean mass.
          </p>
        ) : (
          targets.bodyFatPct && (
            <p className="text-ink-faint">
              Body fat looks like roughly {Math.round(targets.bodyFatPct.value * 100)}%
              <EstimateMark basis={targets.bodyFatPct.basis} /> — shown for reference only. It is
              not used in the calorie maths; record a measured figure with a weigh-in and it will
              be.
            </p>
          )
        )}

        {targets.projectedWeeklyChangeKg != null && (
          <p
            className={clsx(
              targets.rateVerdict === 'fast'
                ? 'text-amber-400'
                : targets.rateVerdict === 'slow'
                  ? 'text-ink-faint'
                  : 'text-emerald-400',
            )}
          >
            At this target you would change about{' '}
            <span className="tabular font-semibold">
              {targets.projectedWeeklyChangeKg > 0 ? '+' : ''}
              {targets.projectedWeeklyChangeKg} kg
            </span>{' '}
            a week
            <EstimateMark basis="Energy difference from maintenance × 7 ÷ 7700 kcal per kg. A rule of thumb: real loss slows as you get lighter, because maintenance falls with you." />
            {targets.rateVerdict === 'fast' && ' — faster than is usually worth it.'}
            {targets.rateVerdict === 'slow' && ' — slow enough to be hard to see week to week.'}
          </p>
        )}

        {targets.floorApplied && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
            {targets.floorApplied.reason}
          </p>
        )}

        {targets.macroAdjustment && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
            {targets.macroAdjustment.reason}
          </p>
        )}

        {targets.goalNote && <p className="text-ink-faint">{targets.goalNote}</p>}
      </div>
    </Panel>
  );
}
