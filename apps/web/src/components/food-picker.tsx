'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import type { FoodWithUsage } from '@life-portal/shared-types';
import { mgToG } from '@life-portal/shared-domain';
import { EmptyState, Input } from './ui';

/**
 * The food list, in the order that makes logging fast: favourites, then what was eaten most
 * recently, then what was added most recently. That order is decided by the API (derived from the
 * log, never stored), so this component only filters and renders it.
 */
export function FoodPicker({
  foods,
  selectedId,
  onSelect,
  emptyAction,
}: {
  foods: FoodWithUsage[];
  selectedId?: string;
  onSelect: (food: FoodWithUsage) => void;
  emptyAction?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return foods;
    return foods.filter((food) =>
      `${food.name} ${food.brand ?? ''}`.toLowerCase().includes(needle),
    );
  }, [foods, query]);

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="Search your foods…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search foods"
      />

      {matches.length === 0 ? (
        <EmptyState
          message={
            foods.length === 0
              ? 'No foods yet. Add one and it will be here for good.'
              : `Nothing matching "${query.trim()}".`
          }
          action={emptyAction}
        />
      ) : (
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {matches.map((food) => (
            <li key={food.id}>
              <button
                type="button"
                onClick={() => onSelect(food)}
                aria-pressed={food.id === selectedId}
                className={clsx(
                  'flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm transition',
                  food.id === selectedId
                    ? 'bg-lime-500/10 text-ink'
                    : 'text-ink-muted hover:bg-surface hover:text-ink',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {food.favourite && <span className="mr-1 text-amber-400">★</span>}
                    {food.name}
                  </span>
                  {food.brand && <span className="block truncate text-xs text-ink-faint">{food.brand}</span>}
                </span>
                <span className="shrink-0 text-right text-xs text-ink-faint">
                  <span className="tabular block text-ink-muted">
                    {food.perServing.energyKcal} kcal
                  </span>
                  <span className="tabular">
                    {food.servingSize} {food.unit} · P {mgToG(food.perServing.proteinMg)} g
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
