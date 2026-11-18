'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { MealSlot } from '@life-portal/shared-types';

/**
 * Which meals of the Food day are folded away. A view preference, like light or dark: kept in
 * this browser only, the same on every day, and nothing about what was eaten.
 */
const KEY = 'lp.food.collapsed.v1';
const EVENT = 'lp-food-collapsed';
let memory = '';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return memory;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(EVENT, callback);
  };
}

/** `[collapsed, set]` for one meal. Open until the person folds it. */
export function useCollapsedSlot(slot: MealSlot): readonly [boolean, (collapsed: boolean) => void] {
  const stored = useSyncExternalStore(subscribe, read, () => '');
  const collapsed = stored.split(',').includes(slot);
  const set = useCallback(
    (next: boolean) => {
      const slots = new Set(read().split(',').filter(Boolean));
      if (next) slots.add(slot);
      else slots.delete(slot);
      memory = [...slots].join(',');
      try {
        localStorage.setItem(KEY, memory);
      } catch {
        /* Storage blocked: the choice lasts for this visit. */
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [slot],
  );
  return [collapsed, set] as const;
}
