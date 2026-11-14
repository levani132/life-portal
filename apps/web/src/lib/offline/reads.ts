import { addDays } from '@life-portal/shared-domain';
import type { FoodPost, NutritionOverview, PostPage, SocialProfile } from '@life-portal/shared-types';
import { api, ApiError, NetworkError } from '../api';
import { keptOwnPage, keptOwnPost, keptOwnProfile } from './own-posts';
import { capFoods, emptyDayFrom } from './nutrition-overlay';
import { waitForOfflineCache } from './runtime';

/**
 * Which reads are kept on the device for offline use (specs 028 and 029), and under what cache
 * key. Exact paths only: a search or a date range is never kept, so the cache holds what the
 * offline screens need and not a copy of every request. The one query string kept is the Food
 * day (`?today=&day=`), one copy per day. Only allowlisted modules can be listed here at all
 * (`OfflineCache` refuses anything else).
 */
const NUTRITION_DAY = /^\/nutrition\?today=(\d{4}-\d{2}-\d{2})&day=(\d{4}-\d{2}-\d{2})$/;

const READS: [RegExp, (match: RegExpMatchArray) => string][] = [
  [/^\/training\/profile$/, () => 'training:profile'],
  [/^\/training\/plans$/, () => 'training:plans'],
  [/^\/training\/plans\/([0-9a-f]{24})$/, (m) => `training:plan:${m[1]}`],
  [/^\/training\/sessions\/current$/, () => 'training:current'],
  [/^\/training\/sessions$/, () => 'training:history'],
  [/^\/training\/sessions\/([0-9a-f]{24})$/, (m) => `training:session:${m[1]}`],
  [/^\/training\/exercises\/offline$/, () => 'training:exercises'],
  // The day-start hour decides which day a workout belongs to.
  [/^\/nutrition\/profile$/, () => 'nutrition:profile'],
  // Spec 029: the Food day, one copy per day viewed.
  [NUTRITION_DAY, (m) => `nutrition:day:${m[2]}`],
];

/**
 * Spec 033 (issue #20 S3): reads kept only in part, through a filter. The person's own posts
 * only: `keep` returns what may be kept, or `undefined`, and then any older copy is removed too.
 * A refusal from the server (the post deleted, say) removes the copy as well.
 */
const FILTERED: [RegExp, (match: RegExpMatchArray) => string, (data: unknown) => unknown][] = [
  [/^\/posts\/([0-9a-f]{24})$/, (m) => `social:post:${m[1]}`, (data) => keptOwnPost(data as FoodPost)],
  [
    /^\/posts\?authorId=([0-9a-f]{24})&preview=([a-z]+)$/,
    (m) => `social:own-posts:${m[1]}:${m[2]}`,
    (data) => keptOwnPage(data as PostPage),
  ],
  // The own profile's header (the day is only for its food diary, which is not kept).
  [
    /^\/social\/me\?preview=(normal|friend|stranger)&today=\d{4}-\d{2}-\d{2}$/,
    (m) => `social:me:${m[1]}`,
    (data) => keptOwnProfile(data as SocialProfile),
  ],
];

function filteredRead(path: string): { key: string; keep: (data: unknown) => unknown } | undefined {
  for (const [pattern, key, keep] of FILTERED) {
    const match = path.match(pattern);
    if (match) return { key: key(match), keep };
  }
  return undefined;
}

/** Days of Food kept on the device, counting back from today (owner's choice on #18). */
export const NUTRITION_DAYS_KEPT = 14;
const LATEST_NUTRITION = 'nutrition:day:latest';

/**
 * What is kept for a Food day: nothing for a day more than 14 days back, and at most 2,000 foods.
 * Meals waiting to be sent carry their own provisional facts, so trimming the foods never loses
 * what a pending meal needs. The newest copy is also kept as `latest`, for a day never opened.
 */
async function keepNutritionDay(match: RegExpMatchArray, data: NutritionOverview, put: (key: string, value: unknown) => Promise<void>) {
  const [, today, day] = match;
  if (day < addDays(today, -NUTRITION_DAYS_KEPT)) return;
  const kept = capFoods(data);
  await put(`nutrition:day:${day}`, kept);
  await put(LATEST_NUTRITION, kept);
}

export function offlineReadKey(path: string): string | undefined {
  for (const [pattern, key] of READS) {
    const match = path.match(pattern);
    if (match) return key(match);
  }
  return undefined;
}

/** Paths answered from the device on the last read, so the UI can say so. */
const fromDevice = new Set<string>();
export const isDeviceCopy = (path: string) => fromDevice.has(path);

/**
 * GET with a kept copy: every answer to a listed path is kept, and when the request gets no
 * answer at all the kept copy is returned instead. A refusal from the server (`ApiError`) is
 * never hidden behind an old copy.
 */
export async function getWithOfflineCopy<T>(path: string): Promise<T> {
  const filtered = filteredRead(path);
  const key = offlineReadKey(path) ?? filtered?.key;
  try {
    const data = await api.get<T>(path);
    fromDevice.delete(path);
    if (filtered) {
      const kept = filtered.keep(data);
      void waitForOfflineCache()
        .then((cache) => (kept === undefined ? cache?.remove(filtered.key) : cache?.put(filtered.key, kept)))
        .catch(() => undefined);
      return data;
    }
    const day = path.match(NUTRITION_DAY);
    if (day) {
      void waitForOfflineCache()
        .then((cache) => cache && keepNutritionDay(day, data as NutritionOverview, (k, v) => cache.put(k, v)))
        .catch(() => undefined);
    } else if (key) {
      void waitForOfflineCache().then((cache) => cache?.put(key, data ?? null)).catch(() => undefined);
    }
    return data;
  } catch (error) {
    // The server's verdict on a kept post (deleted, or no longer the person's): forget the copy.
    if (filtered && error instanceof ApiError)
      void waitForOfflineCache()
        .then((cache) => cache?.remove(filtered.key))
        .catch(() => undefined);
    if (!key || !(error instanceof NetworkError)) throw error;
    const cache = await waitForOfflineCache();
    let kept = await cache?.get<T>(key).catch(() => undefined);
    const day = path.match(NUTRITION_DAY);
    if (kept === undefined && day) {
      // A day never opened on this device (a new day, say): the latest copy's foods, meals and
      // targets with nothing eaten yet, so food can still be logged.
      const latest = await cache?.get<NutritionOverview>(LATEST_NUTRITION).catch(() => undefined);
      if (latest) kept = emptyDayFrom(latest, day[2]) as Awaited<T>;
    }
    if (kept === undefined) throw error;
    fromDevice.add(path);
    return kept as T;
  }
}
