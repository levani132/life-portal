'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Food, FoodWithUsage, SavedMeal } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { useBrands } from '../lib/brands';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { newPostHref } from '../lib/new-post';
import { BrandsManager } from './brands-manager';
import { FoodCard } from './food-card';
import { FoodCombobox } from './food-combobox';
import { FoodForm } from './food-form';
import { PageHeader } from './page-header';
import { ExerciseLibrary } from './training/exercise-library';
import { Plans } from './training/plans';
import { ErrorNote, Field, Input, Modal, Spinner } from './ui';

const FOODS_KEY = '/nutrition/foods';
const MEALS_KEY = '/nutrition/meals';

const SECTIONS = [
  { id: 'foods', label: 'Foods' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'plans', label: 'Training plans' },
  { id: 'exercises', label: 'Exercises' },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

/**
 * A page's library (spec 041): the foods, recipes, exercises and training plans it publishes
 * from. Nothing here is a diary or a workout; a page keeps content, and "Post" on any item
 * opens the composer with it attached.
 */
export function PageLibrary() {
  const [section, setSection] = useState<Section>('foods');
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Library" subtitle="What this page publishes from. Post any of it for people to save." />
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto px-4" role="tablist" aria-label="Library">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            onClick={() => setSection(item.id)}
            className={clsx(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium',
              section === item.id ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {section === 'foods' && <Foods />}
      {section === 'recipes' && <Recipes />}
      {section === 'plans' && <Plans onStarted={() => undefined} />}
      {section === 'exercises' && <ExerciseLibrary />}
    </div>
  );
}

const changed = () => Promise.all([revalidate(FOODS_KEY), revalidate(MEALS_KEY)]);

function Foods() {
  const foods = useApi<FoodWithUsage[]>(FOODS_KEY);
  const brands = useBrands();
  const action = useAction();
  const [editing, setEditing] = useState<Food | 'new' | null>(null);
  const [managingBrands, setManagingBrands] = useState(false);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const live = (foods.data ?? []).filter((food) => !food.archived);
    return needle ? live.filter((food) => `${food.name} ${food.brand ?? ''}`.toLowerCase().includes(needle)) : live;
  }, [foods.data, query]);
  const brandOf = (food: FoodWithUsage) => brands.find(food.brand);
  const act = (fn: () => Promise<unknown>) =>
    action.run(
      async () => {
        await fn();
        await changed();
      },
      { revalidate: false },
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search foods"
          placeholder="Search foods"
          className="flex-1"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="btn-ghost" onClick={() => setManagingBrands(true)}>
          Brands
        </button>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> New food
        </button>
      </div>
      {action.error && <ErrorNote message={action.error} />}
      {foods.error ? (
        <ErrorNote message={(foods.error as Error).message} />
      ) : !foods.data ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <p className="card p-6 text-sm text-ink-muted">
          {query ? 'No food matches.' : 'No foods yet. Add the foods this page wants people to find and save.'}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((food) => (
            <FoodCard
              key={food.id}
              food={food}
              brand={brandOf(food)}
              busy={action.pending}
              onEdit={() => setEditing(food)}
              onFavourite={() => void act(() => api.patch(`/nutrition/foods/${food.id}`, { favourite: !food.favourite }))}
              onDelete={() => {
                if (window.confirm(`Delete ${food.name}?`)) void act(() => api.delete(`/nutrition/foods/${food.id}`));
              }}
              onShare={() => window.location.assign(newPostHref({ kind: 'food', foodId: food.id }))}
            />
          ))}
        </ul>
      )}
      <FoodForm
        open={editing !== null}
        onClose={() => setEditing(null)}
        food={editing && editing !== 'new' ? editing : undefined}
        lookupAvailable
        onSaved={() => void changed()}
      />
      <BrandsManager open={managingBrands} onClose={() => setManagingBrands(false)} />
    </div>
  );
}

function Recipes() {
  const meals = useApi<SavedMeal[]>(MEALS_KEY);
  const foods = useApi<FoodWithUsage[]>(FOODS_KEY);
  const action = useAction();
  const [editing, setEditing] = useState<SavedMeal | 'new' | null>(null);
  const live = useMemo(() => (foods.data ?? []).filter((food) => !food.archived), [foods.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">A recipe is a set of this page’s foods with amounts.</p>
        <button type="button" className="btn-primary shrink-0" disabled={!live.length} onClick={() => setEditing('new')}>
          <Plus size={16} /> New recipe
        </button>
      </div>
      {action.error && <ErrorNote message={action.error} />}
      {meals.error ? (
        <ErrorNote message={(meals.error as Error).message} />
      ) : !meals.data ? (
        <Spinner />
      ) : meals.data.length === 0 ? (
        <p className="card p-6 text-sm text-ink-muted">
          {live.length ? 'No recipes yet.' : 'Add foods first: a recipe is built from them.'}
        </p>
      ) : (
        <ul className="card divide-y divide-border">
          {meals.data.map((meal) => (
            <li key={meal.id} className="flex items-center gap-2 px-4 py-3">
              <div className="flex-1">
                <p className="font-medium">{meal.name}</p>
                <p className="text-xs text-ink-faint">
                  {meal.components.length} {meal.components.length === 1 ? 'food' : 'foods'} · {meal.totals.energyKcal} kcal
                  {meal.loggable ? '' : ' · a food is missing'}
                </p>
              </div>
              <Link
                href={newPostHref({ kind: 'combination', savedMealId: meal.id })}
                className="btn-ghost"
                aria-label={`Post ${meal.name}`}
              >
                <Share2 size={16} /> Post
              </Link>
              <button type="button" className="btn-ghost" aria-label={`Edit ${meal.name}`} onClick={() => setEditing(meal)}>
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="btn-ghost"
                aria-label={`Delete ${meal.name}`}
                disabled={action.pending}
                onClick={() => {
                  if (window.confirm(`Delete ${meal.name}?`))
                    void action.run(
                      async () => {
                        await api.delete(`/nutrition/meals/${meal.id}`);
                        await changed();
                      },
                      { revalidate: false },
                    );
                }}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <RecipeEditor meal={editing === 'new' ? undefined : editing} foods={live} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

interface Row {
  key: string;
  food?: FoodWithUsage;
  amount: string;
}

const MAX_ROWS = 20;
let rowSeq = 0;
const newRow = (food?: FoodWithUsage, amount = ''): Row => ({ key: `row-${rowSeq++}`, food, amount });

/** Name a recipe and list its foods with amounts, in each food's own unit. */
export function RecipeEditor({
  meal,
  foods,
  onClose,
  onSaved,
}: {
  meal?: SavedMeal;
  foods: FoodWithUsage[];
  onClose: () => void;
  onSaved?: (meal: SavedMeal) => void;
}) {
  const action = useAction();
  const [name, setName] = useState(meal?.name ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    meal
      ? meal.components.map((component) => newRow(foods.find((food) => food.id === component.foodId), String(component.amount)))
      : [newRow()],
  );
  const set = (key: string, patch: Partial<Row>) => setRows((all) => all.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const components = rows
    .filter((row) => row.food && Number(row.amount) >= 1)
    .map((row) => ({ foodId: (row.food as FoodWithUsage).id, amount: Math.round(Number(row.amount)) }));
  const ready = name.trim().length > 0 && components.length > 0 && components.length === rows.filter((row) => row.food || row.amount).length;

  const save = () =>
    action
      .run(
        async () => {
          const body = { name: name.trim(), components };
          const result = await (meal ? api.patch<SavedMeal>(`/nutrition/meals/${meal.id}`, body) : api.post<SavedMeal>(MEALS_KEY, body));
          await changed();
          onSaved?.(result);
        },
        { revalidate: false },
      )
      .then((ok) => ok && !onSaved && onClose());

  return (
    <Modal open onClose={onClose} title={meal ? 'Edit recipe' : 'New recipe'}>
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </Field>
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.key} className="flex items-end gap-2">
              <div className="flex-1">
                <FoodCombobox foods={foods} selected={row.food} onSelect={(food) => set(row.key, { food, amount: row.amount || String(food.servingSize) })} />
              </div>
              <Input
                inputMode="numeric"
                aria-label={`Amount${row.food ? ` of ${row.food.name}` : ''}`}
                className="w-24"
                placeholder={row.food?.unit ?? 'g'}
                value={row.amount}
                onChange={(event) => set(row.key, { amount: event.target.value.replace(/\D/g, '') })}
              />
              <button
                type="button"
                className="btn-ghost"
                aria-label="Remove this food"
                disabled={rows.length === 1}
                onClick={() => setRows((all) => all.filter((item) => item.key !== row.key))}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
        {rows.length < MAX_ROWS && (
          <button type="button" className="btn-ghost" onClick={() => setRows((all) => [...all, newRow()])}>
            <Plus size={16} /> Add a food
          </button>
        )}
        {action.error && <ErrorNote message={action.error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!ready || action.pending} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
