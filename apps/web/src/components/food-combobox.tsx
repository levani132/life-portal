'use client';

import clsx from 'clsx';
import { ChevronDown, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { FoodWithUsage } from '@life-portal/shared-types';
import { mgToG } from '@life-portal/shared-domain';
import { MACRO_TEXT } from '../lib/macro-colors';
import { FoodThumb } from './food-thumb';

/**
 * The log modal's food field: a search box whose list opens when it is pressed, like a select,
 * and folds into a card once a food is chosen. The order is the API's (favourites, then most
 * recently eaten), so with an empty query the usual foods are at the top.
 *
 * The list is inline rather than floating, so the modal's scroll never clips it.
 */
export function FoodCombobox({
  foods,
  selected,
  onSelect,
  onCreate,
}: {
  foods: FoodWithUsage[];
  selected?: FoodWithUsage;
  onSelect: (food: FoodWithUsage) => void;
  /** Receives what was typed, so the new food can start with that name. */
  onCreate?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return foods;
    return foods.filter((food) =>
      `${food.name} ${food.brand ?? ''}`.toLowerCase().includes(needle),
    );
  }, [foods, query]);

  useEffect(() => setActive(0), [query]);

  // A press anywhere outside closes the list. Pointer events rather than blur, because iOS does
  // not focus a tapped button, so a blur would close the list before the tap could choose.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (food: FoodWithUsage) => {
    onSelect(food);
    setOpen(false);
    setQuery('');
    input.current?.blur();
  };

  const reopen = () => {
    setOpen(true);
    // The input only exists once the card has folded away.
    requestAnimationFrame(() => input.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(matches.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      // Enter picks the highlighted food. It never submits the modal's form — with nothing
      // chosen yet, that would send a meal without a food.
      event.preventDefault();
      if (open && matches[active]) choose(matches[active]);
    } else if (event.key === 'Escape' && (open || query)) {
      // Close the list, not the modal (whose Escape listener is on window).
      event.stopPropagation();
      setOpen(false);
      setQuery('');
    }
  };

  if (selected && !open) {
    return (
      <button
        type="button"
        onClick={reopen}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition hover:border-accent"
        aria-label={`Food: ${selected.name}. Change`}
      >
        <FoodThumb
          name={selected.name}
          imageUrl={selected.image?.url}
          macros={selected.perServing}
          size={44}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{selected.name}</span>
          <span className="block truncate text-xs text-ink-faint">
            {[selected.brand, servingText(selected)].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={clsx('tabular block text-sm font-semibold', MACRO_TEXT.kcal)}>
            {selected.perServing.energyKcal}
            <span className="ml-0.5 text-[10px] font-normal text-ink-faint">kcal</span>
          </span>
          <MacroLine food={selected} />
        </span>
        <ChevronDown size={16} className="shrink-0 text-ink-faint" aria-hidden />
      </button>
    );
  }

  return (
    <div ref={root} className="relative">
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          aria-hidden
        />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls="food-combobox-list"
          aria-label="Search foods"
          placeholder={selected ? `Change ${selected.name}…` : 'What did you eat?'}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          autoComplete="off"
          className="field pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
        />
        {(query || (selected && open)) && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink"
            aria-label={query ? 'Clear search' : 'Keep the chosen food'}
            onClick={() => {
              if (query) {
                setQuery('');
                input.current?.focus();
              } else setOpen(false);
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {open && (
        <ul
          id="food-combobox-list"
          ref={list}
          role="listbox"
          className="mt-1.5 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-ink-faint">
              {foods.length === 0
                ? 'No foods yet. Add one and it will be here for good.'
                : `Nothing matching “${query.trim()}”.`}
            </li>
          )}
          {matches.map((food, index) => (
            <li key={food.id} role="option" aria-selected={food.id === selected?.id}>
              <button
                type="button"
                data-index={index}
                onClick={() => choose(food)}
                onPointerEnter={() => setActive(index)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition',
                  index === active ? 'bg-surface-raised' : '',
                  food.id === selected?.id && 'ring-1 ring-inset ring-accent/50',
                )}
              >
                <FoodThumb
                  name={food.name}
                  imageUrl={food.image?.url}
                  macros={food.perServing}
                  size={36}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {food.favourite && <span className="mr-1 text-amber-400">★</span>}
                    {food.name}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">
                    {[food.brand, servingText(food)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="tabular block text-sm font-medium text-ink">
                    {food.perServing.energyKcal}
                    <span className="ml-0.5 text-[10px] font-normal text-ink-faint">kcal</span>
                  </span>
                  <MacroLine food={food} />
                </span>
              </button>
            </li>
          ))}
          {onCreate && (
            <li className="border-t border-border pt-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCreate(query.trim());
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-accent hover:bg-surface-raised"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-accent/50">
                  <Plus size={16} />
                </span>
                {query.trim() ? `Add “${query.trim()}” as a new food` : 'Add a new food'}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function servingText(food: FoodWithUsage) {
  return food.servingLabel
    ? `${food.servingLabel} (${food.servingSize} ${food.unit})`
    : `${food.servingSize} ${food.unit}`;
}

/** Per serving, each letter in its macro's colour. */
function MacroLine({ food }: { food: FoodWithUsage }) {
  const { proteinMg, carbMg, fatMg } = food.perServing;
  return (
    <span className="tabular block text-[10px] text-ink-faint">
      <span className={MACRO_TEXT.protein}>P</span> {mgToG(proteinMg)}{' '}
      <span className={MACRO_TEXT.carbs}>C</span> {mgToG(carbMg)}{' '}
      <span className={MACRO_TEXT.fat}>F</span> {mgToG(fatMg)}
    </span>
  );
}
