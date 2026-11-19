'use client';

import { useMemo } from 'react';
import type { FoodBrand } from '@life-portal/shared-types';
import { brandKey, topBrandKeys } from '@life-portal/shared-domain';
import { useApi } from './hooks';

/** Every public brand and the person's own. */
export const BRANDS_KEY = '/nutrition/brands';

/**
 * The brands, and a lookup from any spelling of a brand's name to the brand. A food carries
 * its brand as a name, so this is how a food finds its logo. Without a connection there are
 * simply no logos: names still show.
 */
export function useBrands() {
  const { data, mutate } = useApi<FoodBrand[]>(BRANDS_KEY, { shouldRetryOnError: false });
  const byKey = useMemo(() => new Map((data ?? []).map((brand) => [brand.key, brand])), [data]);
  return {
    brands: data ?? [],
    loaded: !!data,
    find: (name: string | undefined) => byKey.get(brandKey(name)),
    refresh: () => mutate(),
  };
}

/** The brands a person uses most (up to `limit`), each with its name as their foods spell it. */
export function useTopBrands(
  foods: readonly { brand?: string; useCount?: number; archived?: boolean }[],
  limit = 5,
): { key: string; name: string }[] {
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const food of foods) {
      const key = brandKey(food.brand);
      if (key && food.brand && !names.has(key)) names.set(key, food.brand);
    }
    return topBrandKeys(foods, limit).map((key) => ({ key, name: names.get(key) ?? key }));
  }, [foods, limit]);
}
