/**
 * Food brands: the pure parts. What makes two spellings the same brand, and which brands a
 * person uses most.
 */

/**
 * What two spellings of one brand share: lower case, accents removed, and nothing but letters
 * and digits. "McDonald's", "mcdonalds" and "Mc Donalds" are one brand; "Nestlé" and "Nestle"
 * are one brand. Empty when the name has no letter or digit.
 */
export function brandKey(name: string | undefined | null): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** A brand name as it is stored: trimmed, inner spaces collapsed. */
export function cleanBrandName(name: string | undefined | null): string {
  return (name ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The brands a person uses most, as keys, most used first: by how often their foods of that
 * brand were eaten, then by how many foods they have of it, then by name. Foods with no brand,
 * and archived ones, do not count.
 */
export function topBrandKeys(
  foods: readonly { brand?: string; useCount?: number; archived?: boolean }[],
  limit = 5,
): string[] {
  const tally = new Map<string, { uses: number; foods: number }>();
  for (const food of foods) {
    const key = brandKey(food.brand);
    if (!key || food.archived) continue;
    const entry = tally.get(key) ?? { uses: 0, foods: 0 };
    entry.uses += food.useCount ?? 0;
    entry.foods += 1;
    tally.set(key, entry);
  }
  return [...tally.entries()]
    .sort(([a, x], [b, y]) => y.uses - x.uses || y.foods - x.foods || a.localeCompare(b))
    .slice(0, Math.max(0, limit))
    .map(([key]) => key);
}
