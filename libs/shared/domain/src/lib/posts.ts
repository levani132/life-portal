import type {
  Audience,
  FoodPublication,
  PostSelection,
  PublishedFood,
  PublishedMacros,
} from '@life-portal/shared-types';
import { entryTotals } from './nutrition';
const FACT_KEYS = [
  'energyKcalPer100',
  'proteinMgPer100',
  'fatMgPer100',
  'carbMgPer100',
  'fibreMgPer100',
  'sugarMgPer100',
  'satFatMgPer100',
  'sodiumMgPer100',
] as const;
/** Fixed-key canonical data for duplicate detection and server-side cryptographic hashing. */
export function publicationFoodIdentity(food: PublishedFood): string {
  return JSON.stringify([
    food.name.trim().toLowerCase(),
    food.brand?.trim().toLowerCase() ?? '',
    food.unit,
    food.servingSize,
    food.servingLabel ?? '',
    ...FACT_KEYS.map((key) => food[key] ?? null),
  ]);
}
export function canonicalPublication(publication: FoodPublication): string {
  return JSON.stringify([
    publication.kind,
    publication.label,
    publication.day ?? null,
    publication.slot ?? null,
    ...(publication.targets
      ? [
          [
            publication.targets.energyKcal ?? null,
            publication.targets.proteinG ?? null,
            publication.targets.carbG ?? null,
            publication.targets.fatG ?? null,
          ],
        ]
      : []),
    publication.items.map((item) => [
      item.key,
      item.name,
      item.brand ?? null,
      publicationFoodIdentity(item),
      item.amount ?? null,
      item.slot ?? null,
      item.attribution?.label ?? null,
      item.attribution?.url ?? null,
    ]),
  ]);
}
export function validPostSelection(selection: PostSelection): boolean {
  const allowed: Record<PostSelection['kind'], string[]> = {
    entry: ['entryId'],
    meal: ['day', 'slot'],
    day: ['day'],
    food: ['foodId'],
    database: [],
    combination: selection.savedMealId ? ['savedMealId'] : ['components'],
  };
  const keys = allowed[selection.kind];
  if (!keys) return false;
  return (
    keys.every((key) => selection[key as keyof PostSelection] !== undefined) &&
    Object.keys(selection).every((key) => key === 'kind' || keys.includes(key))
  );
}
export function canReadFoodPost(input: {
  own: boolean;
  audience: Audience;
  friends: boolean;
  blocked: boolean;
  enabled: boolean;
}): boolean {
  return (
    input.enabled &&
    !input.blocked &&
    (input.own ||
      input.audience === 'public' ||
      (input.audience === 'friends' && input.friends))
  );
}
/**
 * Whether a member may repost a post they can already read: never their own, never a private
 * one. The repost keeps the original's audience, and every read re-checks the original.
 */
export function canRepost(input: { own: boolean; audience: Audience }): boolean {
  return !input.own && input.audience !== 'private';
}
export function publicationCalories(
  items: PublishedFood[],
): number | undefined {
  return items.every((item) => item.amount !== undefined)
    ? items.reduce(
        (sum, item) => sum + entryTotals(item.amount!, item).energyKcal,
        0,
      )
    : undefined;
}

export function publicationMacros(
  items: PublishedFood[],
): PublishedMacros | undefined {
  if (!items.every((item) => item.amount !== undefined)) return undefined;
  return items.reduce(
    (total, item) => {
      const value = entryTotals(item.amount ?? 0, item);
      return {
        energyKcal: total.energyKcal + value.energyKcal,
        proteinG: total.proteinG + value.proteinMg / 1000,
        carbG: total.carbG + value.carbMg / 1000,
        fatG: total.fatG + value.fatMg / 1000,
      };
    },
    { energyKcal: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );
}
