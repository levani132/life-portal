'use client';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Apple,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CookingPot,
  Layers,
  Library,
  Search,
  Utensils,
  X,
} from 'lucide-react';
import type {
  MealSlot,
  NutritionOverview,
  PostSelection,
} from '@life-portal/shared-types';
import { addDays } from '@life-portal/shared-domain';
import { useApi } from '../lib/hooks';
import { mealContextNow } from '../lib/local-day';
import { ErrorNote, Input, Spinner } from './ui';

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
  uncategorized: 'Anything else',
};
type Tab = 'diary' | 'foods' | 'meals' | 'database';
const TABS: { id: Tab; label: string }[] = [
  { id: 'diary', label: 'Diary' },
  { id: 'foods', label: 'Foods' },
  { id: 'meals', label: 'Saved meals' },
  { id: 'database', label: 'Database' },
];

/** What a selection is called once it is attached to a post. Shown before the preview loads. */
export interface PickedFood {
  source: PostSelection;
  label: string;
}

/**
 * Chooses something from Food to attach to a post: a logged food, a meal, a whole day, a food,
 * a saved meal or the whole database. The same selections the Food page's share buttons make,
 * so publishing continues exactly as it does from there.
 */
export function PostFoodPicker({
  onPick,
  onClose,
}: {
  onPick: (picked: PickedFood) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('diary');
  const [dayStartHour, setDayStartHour] = useState(4);
  const [today, setToday] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const context = mealContextNow(dayStartHour);
    setToday(context.day);
    setDay((current) => current ?? context.day);
  }, [dayStartHour]);
  const overview = useApi<NutritionOverview>(
    today && day ? `/nutrition?today=${today}&day=${day}` : null,
    { keepPreviousData: true },
  );
  const data = overview.data;
  useEffect(() => {
    if (data && data.profile.dayStartHour !== dayStartHour)
      setDayStartHour(data.profile.dayStartHour);
  }, [data, dayStartHour]);
  const foods = useMemo(() => {
    const live = (data?.foods ?? []).filter((food) => !food.archived);
    const needle = query.trim().toLowerCase();
    return needle
      ? live.filter((food) =>
          `${food.name} ${food.brand ?? ''}`.toLowerCase().includes(needle),
        )
      : live;
  }, [data, query]);
  const pick = (source: PostSelection, label: string) => {
    onPick({ source, label });
    onClose();
  };
  const dayLabel = (value: string) =>
    value === today
      ? 'Today'
      : today && value === addDays(today, -1)
        ? 'Yesterday'
        : new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-surface"
      role="dialog"
      aria-modal="true"
      aria-label="Add from Food"
      data-no-tab-swipe
    >
      <header className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <button
          type="button"
          aria-label="Back to post"
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink/5"
          onClick={onClose}
        >
          <X size={22} />
        </button>
        <h2 className="flex-1 text-center text-base font-semibold">Add from Food</h2>
        <span className="h-10 w-10" />
      </header>
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
            className={clsx(
              'shrink-0 rounded-full px-3.5 py-1.5 text-sm',
              tab === item.id ? 'bg-ink text-surface' : 'text-ink-muted hover:bg-ink/5',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        {overview.error ? (
          <ErrorNote message={(overview.error as Error).message} />
        ) : !data ? (
          <Spinner label="Opening your food…" />
        ) : tab === 'diary' ? (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous day"
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink/5"
                onClick={() => day && setDay(addDays(day, -1))}
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-sm font-semibold">{day && dayLabel(day)}</span>
              <button
                type="button"
                aria-label="Next day"
                disabled={!day || !today || day >= today}
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink/5 disabled:opacity-30"
                onClick={() => day && setDay(addDays(day, 1))}
              >
                <ChevronRight size={20} />
              </button>
            </div>
            {data.day !== day ? (
              <Spinner label="Loading that day…" />
            ) : data.dayTotals.entryCount === 0 ? (
              <p className="py-10 text-center text-sm text-ink-muted">
                Nothing logged on this day.
              </p>
            ) : (
              <ul className="space-y-2">
                <Option
                  icon={CalendarDays}
                  title={`The whole day`}
                  detail={`${data.dayTotals.entryCount} foods · ${data.dayTotals.totals.energyKcal} kcal · with targets`}
                  onClick={() => pick({ kind: 'day', day: data.day }, `${dayLabel(data.day)}’s food`)}
                />
                {data.dayTotals.slots
                  .filter((slot) => slot.entries.length)
                  .map((slot) => (
                    <li key={slot.slot} className="space-y-1">
                      <Option
                        icon={CookingPot}
                        title={SLOT_LABELS[slot.slot]}
                        detail={`${slot.entries.length} food${slot.entries.length === 1 ? '' : 's'} · ${slot.totals.energyKcal} kcal`}
                        onClick={() =>
                          pick({ kind: 'meal', day: data.day, slot: slot.slot }, SLOT_LABELS[slot.slot])
                        }
                      />
                      <ul className="ml-6 space-y-1 border-l border-border pl-2">
                        {slot.entries.map((entry) => (
                          <Option
                            key={entry.id}
                            icon={Utensils}
                            small
                            title={entry.facts.name}
                            detail={`${entry.amount} ${entry.unit}`}
                            onClick={() => pick({ kind: 'entry', entryId: entry.id }, entry.facts.name)}
                          />
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ) : tab === 'foods' ? (
          <div>
            <label className="relative mb-3 block">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <Input
                className="pl-9"
                placeholder="Search your foods"
                aria-label="Search your foods"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {foods.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-muted">No foods found.</p>
            ) : (
              <ul className="space-y-1">
                {foods.map((food) => (
                  <Option
                    key={food.id}
                    icon={Apple}
                    title={food.name}
                    image={food.image?.url}
                    detail={[food.brand, `${food.perServing.energyKcal} kcal per serving`]
                      .filter(Boolean)
                      .join(' · ')}
                    onClick={() => pick({ kind: 'food', foodId: food.id }, food.name)}
                  />
                ))}
              </ul>
            )}
          </div>
        ) : tab === 'meals' ? (
          data.savedMeals.filter((meal) => !meal.archived).length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-muted">No saved meals yet.</p>
          ) : (
            <ul className="space-y-1">
              {data.savedMeals
                .filter((meal) => !meal.archived)
                .map((meal) => (
                  <Option
                    key={meal.id}
                    icon={Layers}
                    title={meal.name}
                    detail={`${meal.components.length} foods · ${meal.totals.energyKcal} kcal`}
                    onClick={() => pick({ kind: 'combination', savedMealId: meal.id }, meal.name)}
                  />
                ))}
            </ul>
          )
        ) : (
          <div className="py-4">
            <Option
              icon={Library}
              title="Your whole food database"
              detail={`${data.foods.filter((food) => !food.archived).length} foods, with their nutrition per 100`}
              onClick={() => pick({ kind: 'database' }, 'Food database')}
            />
            <p className="mt-3 px-1 text-xs text-ink-muted">
              Friends who can see the post can save any of these foods to their own database.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Option({
  icon: Icon,
  title,
  detail,
  onClick,
  small,
  image,
}: {
  icon: typeof Apple;
  title: string;
  detail: string;
  onClick: () => void;
  small?: boolean;
  /** A food's own photo, shown in place of the icon. */
  image?: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-ink/5 active:bg-ink/10"
      >
        <span
          className={clsx(
            'flex shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent',
            small ? 'h-8 w-8' : 'h-10 w-10',
          )}
        >
          {image ? (
            <img src={image} alt="" className="h-full w-full rounded-xl object-cover" />
          ) : (
            <Icon size={small ? 15 : 19} aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={clsx('block truncate font-medium', small ? 'text-sm' : 'text-[15px]')}>
            {title}
          </span>
          <span className="block truncate text-xs text-ink-muted">{detail}</span>
        </span>
      </button>
    </li>
  );
}
