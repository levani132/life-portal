import { api, NetworkError } from '../api';
import { waitForOfflineCache } from './runtime';

/**
 * Which reads are kept on the device for offline use (spec 028, issue #17), and under what cache
 * key. Exact paths only: a query string (a search, a date range) is never kept, so the cache
 * holds what the offline screens need and not a copy of every request. Only allowlisted modules
 * can be listed here at all (`OfflineCache` refuses anything else).
 */
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
];

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
  const key = offlineReadKey(path);
  try {
    const data = await api.get<T>(path);
    fromDevice.delete(path);
    if (key) void waitForOfflineCache().then((cache) => cache?.put(key, data ?? null)).catch(() => undefined);
    return data;
  } catch (error) {
    if (!key || !(error instanceof NetworkError)) throw error;
    const cache = await waitForOfflineCache();
    const kept = await cache?.get<T>(key).catch(() => undefined);
    if (kept === undefined) throw error;
    fromDevice.add(path);
    return kept as T;
  }
}
