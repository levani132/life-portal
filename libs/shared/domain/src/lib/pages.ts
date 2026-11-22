import { FEATURE_IDS, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_NONE, type FeatureAccess, type FeatureId } from '@life-portal/shared-types';

/**
 * What a page can use (spec 040). Fixed, not switched per account: everything social, and Food
 * and Training for the library a page publishes from. No money, no work, and nothing that
 * compares people: levels, ranks and tournaments are a person's.
 */
// Messages join in slice 3, with the rule for who a page may write to first.
const PAGE_FEATURES: readonly FeatureId[] = ['social', 'foodPosts', 'postMedia', 'forYou', 'forYouRanking', 'push', 'nutrition', 'training', 'trainingPosts'];

export function pageAccess(): FeatureAccess {
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, PAGE_FEATURES.includes(id)])) as FeatureAccess;
}

/** How many pages this person may have: a number, or `null` for no limit. */
export function pageLimitFor(input: { pageLimit?: number; developer: boolean }): number | null {
  if (input.developer || input.pageLimit === PAGE_LIMIT_NONE) return null;
  return typeof input.pageLimit === 'number' && input.pageLimit >= 0 ? Math.floor(input.pageLimit) : PAGE_LIMIT_DEFAULT;
}

/** How many more pages the person may create: `null` for no limit, never negative. */
export function pagesRemaining(input: { pageLimit?: number; developer: boolean; created: number }): number | null {
  const limit = pageLimitFor(input);
  return limit === null ? null : Math.max(0, limit - input.created);
}

export function mayCreatePage(input: { pageLimit?: number; developer: boolean; created: number }): boolean {
  const remaining = pagesRemaining(input);
  return remaining === null || remaining > 0;
}
