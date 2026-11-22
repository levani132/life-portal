import type {
  Audience,
  FoodPublication,
  PostSelection,
  PublishedFood,
  PublishedMacros,
  ReportReason,
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
  /** A link-only post this viewer was sent, or whose link they opened. Never beats a block. */
  granted?: boolean;
  /** Spec 039: held for a check or a review. Only its author reads it until that is over. */
  held?: boolean;
}): boolean {
  if (input.held && !input.own) return false;
  return (
    input.enabled &&
    !input.blocked &&
    (input.own ||
      input.audience === 'public' ||
      (input.audience === 'friends' && input.friends) ||
      input.granted === true)
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

/** Distinct reporters after which a post is hidden until someone reviews it (spec 039). */
export const REPORTS_TO_HOLD = 3;

/**
 * Whether the reports on a post hide it until a reviewer looks. One report that a child is at
 * risk is enough; anything else takes `REPORTS_TO_HOLD` people. A post a reviewer already kept
 * is never hidden by reports again: they still reach the queue.
 */
export function reportsHoldPost(reasons: readonly ReportReason[], reviewed: boolean): boolean {
  if (reviewed) return false;
  return reasons.includes('child_safety') || reasons.length >= REPORTS_TO_HOLD;
}

/**
 * The categories of an automatic image check that hide a post (spec 039). Deliberately not
 * `violence` alone: sport and food photos trip it. The names are the checking service's.
 */
export const IMAGE_HOLD_CATEGORIES = ['sexual', 'sexual/minors', 'violence/graphic', 'self-harm', 'self-harm/intent', 'self-harm/instructions'] as const;

/** Which of a check's flagged categories hide the post. Empty: it is fine. */
export function imageHoldCategories(flagged: readonly string[]): string[] {
  const hold = new Set<string>(IMAGE_HOLD_CATEGORIES);
  return [...new Set(flagged)].filter((category) => hold.has(category)).sort();
}
