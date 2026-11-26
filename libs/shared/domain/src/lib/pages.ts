import { FEATURE_IDS, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_NONE, type FeatureAccess, type FeatureId } from '@life-portal/shared-types';

/**
 * What a page can use (spec 040). Fixed, not switched per account: everything social, and Food
 * and Training for the library a page publishes from. No money, no work, and nothing that
 * compares people: levels, ranks and tournaments are a person's.
 */
const PAGE_FEATURES: readonly FeatureId[] = ['social', 'messages', 'foodPosts', 'postMedia', 'forYou', 'forYouRanking', 'push', 'nutrition', 'training', 'trainingPosts'];

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

/**
 * Whose posts the Following feed holds (spec 040): your own, your friends' and the pages you
 * follow, each once. Which of their posts you may read is still decided post by post: a friend's
 * by its audience, a page's only when public.
 */
export function followingAuthors(input: { self: string; friends: readonly string[]; followedPages: readonly string[] }): string[] {
  return [...new Set([input.self, ...input.friends, ...input.followedPages])];
}

/**
 * Spec 045: a page's owner. `ownerId` once ownership was handed over; before that, its creator.
 * `undefined` when neither manages it any more (an older page whose creator left).
 */
export function pageOwner(page: { ownerId?: string; createdBy?: string; managers?: readonly string[] }): string | undefined {
  const owner = page.ownerId ?? page.createdBy;
  return owner && (page.managers ?? []).includes(owner) ? owner : undefined;
}

/**
 * Spec 045: whether `requester` may take `target` off a page's managers. A manager may leave; the
 * owner may remove anyone else, but cannot leave (they hand ownership over first, or delete the
 * page). With no owner left, any manager may remove others. Never the last manager.
 */
export function mayRemoveManager(input: { requester: string; target: string; managers: readonly string[]; owner?: string }): boolean {
  const { requester, target, managers, owner } = input;
  if (!managers.includes(requester) || !managers.includes(target) || managers.length < 2) return false;
  if (target === owner) return false;
  if (requester === target || requester === owner) return true;
  return !owner;
}

/** Spec 045: who becomes owner when the owner's account goes: the longest-serving other manager. */
export function nextOwner(managers: readonly string[], leaving: string): string | undefined {
  return managers.find((id) => id !== leaving);
}

/**
 * Spec 045: a page is suspended for its managers only when none of them can act any more: it
 * has managers and every one of them is suspended. Suspending one manager of several leaves the
 * page alone: a page is its own account.
 */
export function pageHasNoActiveManager(managers: readonly string[], suspended: ReadonlySet<string>): boolean {
  return managers.length > 0 && managers.every((id) => suspended.has(id));
}
