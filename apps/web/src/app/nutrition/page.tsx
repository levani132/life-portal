'use client';

import clsx from 'clsx';
import { MACRO_COLORS } from '../../lib/macro-colors';
import { useIsIOS } from '../../lib/ios-device';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookmarkPlus, Bot, Info, Plus, Search, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  PortalState,
  PostSelection,
  Estimate,
  Food,
  FoodWithUsage,
  MealEntry,
  MealSlot,
  MealSuggestion,
  NutritionOverview,
  NutritionTargets,
  SavedMeal,
  SlotTotals,
  TargetFigure,
} from '@life-portal/shared-types';
import {
  addDays,
  figureValue,
  formatDay,
  GOAL_PLAN,
  isRecorded,
  mgToG,
  relativeDays,
} from '@life-portal/shared-domain';
import { AppShell } from '../../components/app-shell';
import { CheatQueue } from '../../components/cheat-queue';
import { FoodCard } from '../../components/food-card';
import { FoodForm } from '../../components/food-form';
import { FoodPicker } from '../../components/food-picker';
import { LogFoodModal } from '../../components/log-food-modal';
import { NutritionRing } from '../../components/home-widget';
import {
  AppleHealthPanel,
  HealthSyncButton,
} from '../../components/apple-health';
import { NutritionSettings } from '../../components/nutrition-settings';
import { PublicFoodsPanel } from '../../components/public-foods-panel';
import {
  Chip,
  EmptyState,
  ErrorNote,
  EstimateMark,
  Field,
  Input,
  Modal,
  Panel,
  Spinner,
} from '../../components/ui';
import { WeekBalancePanel } from '../../components/week-balance';
import { WeighInPanel } from '../../components/weigh-in-panel';
import { WeightTrend } from '../../components/weight-trend';
import { api } from '../../lib/api';
import {
  discardFoodWrite,
  foodWrites,
  isUnsaved,
  useFoodOffline,
  useNutritionDay,
  useRefusedFood,
  useUpdatedAfterSync,
} from '../../lib/nutrition-offline';
import { unsavedCount } from '../../lib/offline/nutrition-overlay';
import { useAction, useApi } from '../../lib/hooks';
import { mealContextNow } from '../../lib/local-day';
import { newPostHref } from '../../lib/new-post';

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
  const portal = useApi<PortalState>('/portal');
  const canPost =
    portal.data?.access.foodPosts &&
    portal.data.access.social &&
    portal.data.access.nutrition;
  const router = useRouter();
  // Sharing opens the new post page with the selection attached.
  const setSharing = (source: PostSelection) => router.push(newPostHref(source));
  const [recentEntry, setRecentEntry] = useState<MealEntry | null>(null);
  const [logging, setLogging] = useState<{
    slot: MealSlot;
    entry?: MealEntry;
  } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'you') setTab('you');
    if (params.get('tab') === 'foods') setTab('foods');
    if (params.get('log') === '1') {
      setLogging({ slot: mealContextNow().slot });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const context = mealContextNow(dayStartHour);
    setToday(context.day);
    setDay((current) => current ?? context.day);
  }, [dayStartHour]);

  const key = today && day ? `/nutrition?today=${today}&day=${day}` : null;
  // Spec 029: the day kept on this device, with meals still waiting to be sent applied.
  const { data, error, isLoading, mutate } = useNutritionDay(key);

  // The profile decides when a day starts, which decides which day this is. One correction.
  useEffect(() => {
    if (data && data.profile.dayStartHour !== dayStartHour)
      setDayStartHour(data.profile.dayStartHour);
  }, [data, dayStartHour]);

  if (isLoading || !today || !day) return <Spinner label="Adding up today…" />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { targets, dayTotals, profile } = data;
  const viewingToday = day === today;
  const refresh = () => void mutate();

  return (
    <>
      <header className="mb-3 space-y-3">
        <div
          className="flex items-center gap-1.5 overflow-x-auto pb-1"
          aria-label="Food controls"
        >
          <div
            className="flex h-10 shrink-0 items-center rounded-lg border border-border p-0.5 text-xs"
            role="group"
            aria-label="Food views"
          >
            {(['today', 'foods', 'you'] as Tab[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTab(option)}
                aria-pressed={tab === option}
                className={clsx(
                  'h-full rounded-md px-2',
                  tab === option
                    ? 'bg-surface-raised text-ink'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {option === 'today'
                  ? 'Today'
                  : option === 'foods'
                    ? 'Foods'
                    : 'You'}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Link
            href="/settings/mcp"
            className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-ink-muted hover:text-ink"
            aria-label="Connect AI assistant"
            title="Connect AI assistant"
          >
            <Bot size={18} />
          </Link>
          <button
            type="button"
            className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-accent-solid px-2.5 text-xs font-medium text-on-accent hover:bg-accent-solid-hover"
            onClick={() =>
              setLogging({ slot: mealContextNow(dayStartHour).slot })
            }
          >
            <Plus size={15} /> Log food
          </button>
        </div>
      </header>

      {canPost && recentEntry && (
        <div className="card mb-5 flex flex-wrap items-center gap-3 p-4">
          <p className="flex-1 text-sm">Food logged. Share it with a post?</p>
          <button
            className="btn-ghost"
            onClick={() => {
              setSharing({ kind: 'entry', entryId: recentEntry.id });
              setRecentEntry(null);
            }}
          >
            Share this food
          </button>
          <button className="btn-ghost" onClick={() => setRecentEntry(null)}>
            Dismiss
          </button>
        </div>
      )}
      {tab === 'today' && (
        <div className="space-y-3">
          <DayNavigator
            day={day}
            today={today}
            onChange={setDay}
            entryCount={dayTotals.entryCount}
            onShare={
              canPost && dayTotals.entryCount > 0
                ? () => setSharing({ kind: 'day', day })
                : undefined
            }
          />

          <FoodSyncNotes overview={data} />
          <MacroTiles totals={dayTotals.totals} targets={targets} />
          {targets.available && (
            <p className="text-xs text-ink-faint">
              Goal: {GOAL_PLAN[profile.goal].label}
            </p>
          )}

          {!targets.available && (
            <MissingInputs targets={targets} onFix={() => setTab('you')} />
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              {dayTotals.slots.map((slot) => (
                <SlotSection
                  key={slot.slot}
                  slot={slot}
                  day={day}
                  suggestions={data.suggestions.filter(
                    (row) => row.slot === slot.slot,
                  )}
                  foods={data.foods}
                  onAdd={() => setLogging({ slot: slot.slot })}
                  onEdit={(entry) => setLogging({ slot: entry.slot, entry })}
                  onChanged={refresh}
                  onShare={canPost ? setSharing : undefined}
                />
              ))}
              {!viewingToday && (
                <p className="text-xs text-ink-faint">
                  You are looking at {formatDay(day)},{' '}
                  {relativeDays(today, day)}. Anything logged here lands on that
                  day.
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

      {tab === 'foods' && (
        <FoodsTab
          overview={data}
          onChanged={refresh}
          onShare={canPost ? setSharing : undefined}
        />
      )}

      {tab === 'you' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            {/* Keyed on the server's own version, so a real change re-seeds the form and an
                ordinary refetch does not (see the note in NutritionSettings). */}
            <NutritionSettings
              key={profile.updatedAt}
              profile={profile}
              onSaved={refresh}
            />
            <WeighInPanel
              weighIns={data.weighIns}
              today={today}
              onSaved={refresh}
            />
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
          today={today}
          slot={logging.slot}
          entry={logging.entry}
          onLogged={(entry) => {
            refresh();
            // A meal not yet saved cannot be shared: a post needs the server's row.
            if (entry && !isUnsaved(entry)) setRecentEntry(entry);
          }}
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
  onShare,
}: {
  onShare?: () => void;
  day: string;
  today: string;
  onChange: (day: string) => void;
  entryCount: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1">
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
      <div className="flex shrink-0 items-center gap-1">
        {onShare && (
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-raised"
            aria-label="Share this day"
            title="Share this day"
            onClick={onShare}
          >
            <Share2 size={17} />
          </button>
        )}
        {day !== today && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => onChange(today)}
          >
            Today
          </button>
        )}
      </div>
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
  const [healthOpen, setHealthOpen] = useState(false);
  const ios = useIsIOS();
  useEffect(() => {
    if (!ios) return;
    const setup = () => setHealthOpen(true);
    window.addEventListener('lp-health-setup', setup);
    return () => window.removeEventListener('lp-health-setup', setup);
  }, [ios]);
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

  const colors = [MACRO_COLORS.kcal, MACRO_COLORS.protein, MACRO_COLORS.carbs, MACRO_COLORS.fat];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((tile, i) => (
          <div
            key={tile.label}
            className="card bg-gradient-to-br from-violet-500/10 to-sky-500/5 p-4"
          >
            <NutritionRing
              metric={{
                label: tile.label,
                value: tile.eaten,
                target: tile.target,
                unit: tile.unit,
                color: colors[i],
                basis:
                  tile.figure && !isRecorded(tile.figure)
                    ? (tile.figure as Estimate<number>).basis
                    : undefined,
              }}
            />
          </div>
        ))}
      </div>
      {ios && (
        <>
          <div className="card flex items-center justify-between gap-2 border-violet-400/30 bg-violet-500/10 px-3 py-2">
            <span className="text-sm">⚡ Activity adjustment</span>
            <div className="flex items-center gap-2">
              <strong className="whitespace-nowrap text-sm">
                {(targets.activity?.adjustmentKcal ?? 0) >= 0 ? '+' : ''}
                {targets.activity?.adjustmentKcal ?? 0} kcal
              </strong>
              <HealthSyncButton />
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full text-violet-400 hover:bg-violet-500/10"
                aria-label="Activity adjustment and Apple Health details"
                title="Activity and Apple Health details"
                onClick={() => setHealthOpen(true)}
              >
                <Info size={19} />
              </button>
            </div>
          </div>
          <Modal
            open={healthOpen}
            onClose={() => setHealthOpen(false)}
            title="Activity & Apple Health"
            wide
          >
            {healthOpen && <AppleHealthPanel activity={targets.activity} />}
          </Modal>
        </>
      )}
    </div>
  );
}

function MissingInputs({
  targets,
  onFix,
}: {
  targets: NutritionTargets;
  onFix: () => void;
}) {
  const missing = targets.missingInputs.map(
    (input) => MISSING_INPUT_LABELS[input] ?? input,
  );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <p>
        No targets yet — they need {missing.join(', ')}. Logging still works; it
        just cannot tell you what is left.
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
  suggestions,
  foods,
  onAdd,
  onEdit,
  onChanged,
  onShare,
}: {
  slot: SlotTotals;
  day: string;
  /** Already filtered to this slot and ranked by the API. */
  suggestions: MealSuggestion[];
  foods: FoodWithUsage[];
  onAdd: () => void;
  onEdit: (entry: MealEntry) => void;
  onChanged: () => void;
  onShare?: (source: PostSelection) => void;
}) {
  const { run, pending } = useAction();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');

  const updatedAfterSync = useUpdatedAfterSync();
  // Spec 029: kept on the device and applied at once; a meal never sent is just withdrawn.
  const remove = (entry: MealEntry) =>
    void run(async () => foodWrites.removeEntry(entry), { revalidate: false }).then((ok) => {
      if (ok) onChanged();
    });

  const saveAsMeal = () =>
    void run(async () =>
      api.post('/nutrition/meals/from-day', {
        name: name.trim(),
        day,
        slot: slot.slot,
      }),
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
          {onShare && slot.entries.length > 0 && (
            <button
              type="button"
              className="flex h-11 w-10 items-center justify-center rounded-lg text-ink-muted transition hover:bg-violet-500/10 hover:text-ink active:scale-95"
              aria-label={`Share ${SLOT_LABELS[slot.slot].toLowerCase()}`}
              title="Share meal"
              onClick={() => onShare({ kind: 'meal', day, slot: slot.slot })}
            >
              <Share2 size={18} aria-hidden="true" />
            </button>
          )}
          {slot.entries.length > 0 && (
            <button
              type="button"
              className="flex h-11 w-10 items-center justify-center rounded-lg text-ink-muted transition hover:bg-violet-500/10 hover:text-ink active:scale-95"
              onClick={() => setSaving(true)}
              aria-label={`Save ${SLOT_LABELS[slot.slot].toLowerCase()} as a meal`}
              title="Save as meal"
            >
              <BookmarkPlus size={18} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="flex h-11 w-10 items-center justify-center rounded-lg text-accent transition hover:bg-violet-500/10 active:scale-95"
            title={`Add to ${SLOT_LABELS[slot.slot].toLowerCase()}`}
            onClick={onAdd}
            aria-label={`Add to ${SLOT_LABELS[slot.slot]}`}
          >
            <Plus size={20} aria-hidden="true" />
          </button>
        </>
      }
    >
      {slot.entries.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {slot.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate">
                  {entry.facts.name}
                  {entry.facts.brand && (
                    <span className="ml-1 text-xs text-ink-faint">
                      {entry.facts.brand}
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-faint">
                  {entry.amount} {entry.unit}
                  {entry.servings > 0 &&
                    ` · ${entry.servings} serving${entry.servings === 1 ? '' : 's'}`}
                  {' · P '}
                  {mgToG(entry.totals.proteinMg)}g C{' '}
                  {mgToG(entry.totals.carbMg)}g F {mgToG(entry.totals.fatMg)}g
                </p>
                {isUnsaved(entry) && (
                  <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    Not saved yet · on this device
                  </p>
                )}
                {updatedAfterSync.has(entry.id) &&
                  updatedAfterSync.get(entry.id) !== entry.totals.energyKcal && (
                    <p className="text-[11px] text-ink-faint">
                      Updated after sync: the food changed since, so it was saved at{' '}
                      {entry.totals.energyKcal} kcal, not {updatedAfterSync.get(entry.id)}.
                    </p>
                  )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="tabular text-ink-muted">
                  {entry.totals.energyKcal} kcal
                </span>
                {onShare && !isUnsaved(entry) && (
                  <button
                    className="text-xs text-accent"
                    onClick={() =>
                      onShare({ kind: 'entry', entryId: entry.id })
                    }
                    aria-label={`Share ${entry.facts.name}`}
                  >
                    share
                  </button>
                )}
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
                  onClick={() => remove(entry)}
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

      <SlotSuggestions
        suggestions={suggestions}
        foods={foods}
        day={day}
        slotLabel={SLOT_LABELS[slot.slot]}
        onChanged={onChanged}
      />

      <Modal
        open={saving}
        onClose={() => setSaving(false)}
        title={`Save ${SLOT_LABELS[slot.slot].toLowerCase()} as a meal`}
        onSubmit={saveAsMeal}
        submitLabel="Save meal"
        pending={pending}
      >
        <Field label="Call it" hint="e.g. my oatmeal bowl">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        <p className="text-xs text-ink-faint">
          Saves the {slot.entries.length} item
          {slot.entries.length === 1 ? '' : 's'} and their amounts. Logging it
          later uses whatever those foods say then.
        </p>
      </Modal>
    </Panel>
  );
}

/**
 * The one-tap strip: what this slot has eaten before, ranked by the API, logged on a single press.
 *
 * The amount shown is the portion from the last day it appeared and the calories are the food's
 * numbers as they are now, so the button says exactly what pressing it adds. There is no
 * confirmation step on purpose — the entry lands in the list directly above with its own ✕.
 */
function SlotSuggestions({
  suggestions,
  foods,
  day,
  slotLabel,
  onChanged,
}: {
  suggestions: MealSuggestion[];
  foods: FoodWithUsage[];
  day: string;
  slotLabel: string;
  onChanged: () => void;
}) {
  const { run, pending, error } = useAction();

  if (suggestions.length === 0) return null;

  // Spec 029: kept on the device and shown at once; sent when there is a connection.
  const log = (suggestion: MealSuggestion) =>
    void run(async () => {
      const food = foods.find((row) => row.id === suggestion.foodId);
      if (!food) throw new Error('That food is not on this device. Log it once you are online.');
      await foodWrites.logEntry(food, { day, slot: suggestion.slot, amount: suggestion.amount });
    }, { revalidate: false }).then((ok) => {
      if (ok) onChanged();
    });

  return (
    <div className="mt-3 rounded-xl border border-dashed border-violet-500/25 bg-violet-500/5 p-3">
      <p className="text-xs font-medium text-ink-muted">Suggestions</p>
      <p className="mb-2 mt-0.5 text-[11px] text-ink-faint">
        From your recent meals · Tap to add to {slotLabel.toLowerCase()}.
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.foodId}
            type="button"
            className="flex min-h-11 max-w-full items-center gap-3 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-left text-xs text-ink-muted transition hover:border-lime-500/40 hover:text-ink active:scale-95 disabled:opacity-50"
            aria-label={`Add suggested ${suggestion.name} to ${slotLabel.toLowerCase()}`}
            onClick={() => log(suggestion)}
            disabled={pending}
            title={
              suggestion.dayCount > 1
                ? `${slotLabel} on ${suggestion.dayCount} of the last 14 days, most recently ${formatDay(suggestion.lastDay)}`
                : `${slotLabel}, ${formatDay(suggestion.lastDay)}`
            }
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">
                {suggestion.name}
              </span>
              <span className="tabular block text-ink-faint">
                {suggestion.amount} {suggestion.unit} ·{' '}
                {suggestion.totals.energyKcal} kcal
                {suggestion.dayCount > 1 && ` · ${suggestion.dayCount} days`}
              </span>
            </span>
            <Plus
              size={15}
              className="shrink-0 text-accent"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
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
        amount: Math.max(
          1,
          Math.round(Number(amount) || selected?.servingSize || 100),
        ),
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
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setAdding(true)}
        >
          + Queue
        </button>
      }
    >
      {cheat.queue.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <Chip tone="neutral">
            queued: {cheat.queueTotals.energyKcal.toLocaleString()} kcal
          </Chip>
          {cheat.bankedKcal > 0 && (
            <Chip tone="good">
              {cheat.bankedKcal.toLocaleString()} kcal banked
            </Chip>
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
          &ldquo;Log it&rdquo; appears on the day itself. Until then this is a
          list, in the order you want it.
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
      api.post('/nutrition/entries/repeat', {
        sourceDay,
        sourceSlot: slot,
        day,
        slot,
      }),
    ).then((ok) => {
      if (ok) onChanged();
    });

  // Spec 029: one meal per component from this device's foods; sent when there is a connection.
  const logMeal = (meal: SavedMeal) =>
    void run(
      async () =>
        foodWrites.logSavedMeal(meal, overview.foods, {
          day,
          slot: meal.defaultSlot ?? 'uncategorized',
        }),
      { revalidate: false },
    ).then((ok) => {
      if (ok) onChanged();
    });

  return (
    <Panel
      title="Log it again"
      description="The same thing, on this day, in one tap."
    >
      {overview.savedMeals.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {overview.savedMeals.map((meal) => (
            <li
              key={meal.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
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
                title={
                  meal.loggable
                    ? undefined
                    : 'One of its foods is gone — fix it under Foods'
                }
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
                <span className="ml-1 text-xs text-ink-faint">
                  {meal.totals.energyKcal} kcal
                </span>
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
  onShare,
}: {
  overview: NutritionOverview;
  onChanged: () => void;
  onShare?: (source: PostSelection) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'favourites' | 'archived'>('all');
  const [editing, setEditing] = useState<Food | null>(null);
  const [adding, setAdding] = useState(false);
  const { run, pending } = useAction();

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return overview.foods.filter((food) => {
      if (filter === 'archived' ? !food.archived : food.archived) return false;
      if (filter === 'favourites' && !food.favourite) return false;
      if (!needle) return true;
      return `${food.name} ${food.brand ?? ''}`.toLowerCase().includes(needle);
    });
  }, [overview.foods, query, filter]);
  const counts = useMemo(
    () => ({
      all: overview.foods.filter((food) => !food.archived).length,
      favourites: overview.foods.filter((food) => food.favourite && !food.archived)
        .length,
      archived: overview.foods.filter((food) => food.archived).length,
    }),
    [overview.foods],
  );

  const toggleFavourite = (food: Food) =>
    void run(async () =>
      api.patch(`/nutrition/foods/${food.id}`, { favourite: !food.favourite }),
    ).then((ok) => {
      if (ok) onChanged();
    });

  const remove = (food: Food) =>
    void run(async () => api.delete(`/nutrition/foods/${food.id}`)).then(
      (ok) => {
        if (ok) onChanged();
      },
    );

  return (
    <div className="space-y-5">
      <Panel
        title="Your foods"
        description={`${counts.all} foods · most eaten first`}
        actions={
          <>
            {onShare && overview.foods.some((f) => !f.archived) && (
              <button
                className="btn-ghost px-2.5"
                onClick={() => onShare({ kind: 'database' })}
                aria-label="Share database"
                title="Share database"
              >
                <Share2 size={15} />
                <span className="hidden sm:inline">Share database</span>
              </button>
            )}
            <button
              type="button"
              className="btn-primary px-3"
              onClick={() => setAdding(true)}
            >
              <Plus size={15} /> Add<span className="hidden sm:inline"> a food</span>
            </button>
          </>
        }
      >
        <div className="mb-4 space-y-2">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <Input
              type="search"
              placeholder="Search by name or brand…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>
          <div
            className="flex gap-1.5 overflow-x-auto"
            role="group"
            aria-label="Show"
          >
            {(
              [
                ['all', 'All'],
                ['favourites', '★ Favourites'],
                ['archived', 'Archived'],
              ] as const
            ).map(([value, label]) =>
              value === 'archived' && counts.archived === 0 ? null : (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={clsx(
                    'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition',
                    filter === value
                      ? 'border-accent bg-accent/10 text-ink'
                      : 'border-border text-ink-muted hover:text-ink',
                  )}
                >
                  {label}
                  <span className="tabular text-ink-faint">{counts[value]}</span>
                </button>
              ),
            )}
          </div>
          {!overview.foodLookup.available && (
            <p className="text-xs text-amber-400">
              Open Food Facts is unavailable — manual entry works as normal
            </p>
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
              <button
                type="button"
                className="btn-primary"
                onClick={() => setAdding(true)}
              >
                Add a food
              </button>
            }
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((food) => (
              <FoodCard
                key={food.id}
                food={food}
                busy={pending}
                onEdit={() => setEditing(food)}
                onFavourite={() => toggleFavourite(food)}
                onDelete={() => remove(food)}
                onShare={
                  onShare
                    ? () => onShare({ kind: 'food', foodId: food.id })
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      <SavedMealsPanel
        overview={overview}
        onChanged={onChanged}
        onShare={onShare}
      />

      <PublicFoodsPanel
        hasPublicFoods={overview.hasPublicFoodsToImport}
        onImported={onChanged}
      />

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
  onShare,
}: {
  overview: NutritionOverview;
  onChanged: () => void;
  onShare?: (source: PostSelection) => void;
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
        <EmptyState message="None yet. Log a breakfast you repeat, then tap its bookmark icon to save it." />
      ) : (
        <ul className="divide-y divide-border">
          {overview.savedMeals.map((meal) => (
            <li key={meal.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate">
                  {meal.name}
                  <span className="ml-2 text-xs text-ink-faint">
                    {meal.totals.energyKcal} kcal · P{' '}
                    {mgToG(meal.totals.proteinMg)}g
                  </span>
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  {onShare && meal.loggable && (
                    <button
                      type="button"
                      className="text-xs text-accent"
                      aria-label={`Share ${meal.name}`}
                      onClick={() =>
                        onShare({ kind: 'combination', savedMealId: meal.id })
                      }
                    >
                      Share
                    </button>
                  )}
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
                  One of its foods is gone, so this cannot be logged until it is
                  fixed.
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
    const missing = targets.missingInputs.map(
      (input) => MISSING_INPUT_LABELS[input] ?? input,
    );
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
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 py-2"
            >
              <dt className="text-sm text-ink-muted">
                {row.label}
                {isRecorded(row.figure) ? (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                    yours
                  </span>
                ) : (
                  <EstimateMark
                    basis={(row.figure as Estimate<number>).basis}
                  />
                )}
              </dt>
              <dd className="tabular text-sm font-semibold">
                {row.figure.value.toLocaleString()}
                <span className="ml-1 text-xs font-normal text-ink-faint">
                  {row.unit}
                </span>
              </dd>
            </div>
          ),
        )}
      </dl>

      <div className="mt-3 space-y-2 text-xs">
        {targets.bodyFatRecordedPct != null ? (
          <p className="text-ink-faint">
            Using your recorded body fat of{' '}
            {Math.round(targets.bodyFatRecordedPct * 1000) / 10}%, so protein
            and fat are set against lean mass.
          </p>
        ) : (
          targets.bodyFatPct && (
            <p className="text-ink-faint">
              Body fat looks like roughly{' '}
              {Math.round(targets.bodyFatPct.value * 100)}%
              <EstimateMark basis={targets.bodyFatPct.basis} /> — shown for
              reference only. It is not used in the calorie maths; record a
              measured figure with a weigh-in and it will be.
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
            {targets.rateVerdict === 'fast' &&
              ' — faster than is usually worth it.'}
            {targets.rateVerdict === 'slow' &&
              ' — slow enough to be hard to see week to week.'}
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

        {targets.goalNote && (
          <p className="text-ink-faint">{targets.goalNote}</p>
        )}
      </div>
    </Panel>
  );
}

/**
 * Spec 029: what is waiting on this device, said plainly. Totals that include meals not yet saved
 * say so; a meal the server refused (its food was deleted meanwhile, say) stays listed with the
 * reason until it is discarded, never silently dropped.
 */
function FoodSyncNotes({ overview }: { overview: NutritionOverview }) {
  const offline = useFoodOffline();
  const refused = useRefusedFood();
  const unsaved = unsavedCount(overview);
  if (!offline && !refused.length && !unsaved) return null;
  return (
    <div className="space-y-2">
      {(offline || unsaved > 0) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {offline ? 'No connection. ' : ''}
          {unsaved > 0
            ? `These totals include ${unsaved} meal${unsaved === 1 ? '' : 's'} not saved yet; they are kept on this device and sent when there is a connection.`
            : 'Changes are kept on this device and sent when it is back.'}
        </p>
      )}
      {refused.map((item) => (
        <div
          key={item.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs"
        >
          <p className="min-w-0 flex-1">
            <span className="font-medium">{item.label ?? 'A change'} was not saved.</span>{' '}
            {item.lastError ?? 'The server refused it.'}
          </p>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => {
              if (window.confirm('Discard this change? It is not on the server.')) void discardFoodWrite(item.id);
            }}
          >
            Discard
          </button>
        </div>
      ))}
    </div>
  );
}
