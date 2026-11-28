/**
 * Pure helpers for leaving and exporting an account (spec 038). They work on stored records as
 * plain objects and know nothing about the database.
 */

/** Field names that never leave in an export: credentials, hashes and where files are stored. */
const SECRET_NAME = /(hash|secret|token|fingerprint)/i;
const STORAGE_FIELDS = new Set(['key', 'posterKey', 'avatarKey', 'wallpaperKey']);
const DROPPED_FIELDS = new Set(['linkKey', 'linkViewers', '__v']);

/** A file's place in storage, as every upload and copy names it (see `MediaService`). */
const STORAGE_KEY = /^(media|foods|brands|training|avatars|wallpapers|posts)\/[A-Za-z0-9/_-]+\.(jpg|mp4|webm|mov)$/;

export function isStorageKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 300 && STORAGE_KEY.test(value);
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Every stored file a record points at, however deep. Only fields that hold a file's place are
 * read, and only values shaped like one, so a brand's name key or a post's link key never match.
 */
export function storageKeysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) storageKeysIn(item, found);
  else if (isPlain(value)) {
    for (const [name, inner] of Object.entries(value)) {
      if (STORAGE_FIELDS.has(name)) {
        if (isStorageKey(inner)) found.add(inner);
      } else storageKeysIn(inner, found);
    }
  }
  return found;
}

/**
 * A record as it goes into an export: ids and dates as text, and no credential, hash, link key
 * or storage location, at any depth. Anything that is not plain data (an id, a date) is turned
 * into text first, so nothing unexpected is walked into.
 */
export function exportRecord(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => exportRecord(item) ?? null);
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const [name, inner] of Object.entries(value)) {
      if (SECRET_NAME.test(name) || DROPPED_FIELDS.has(name)) continue;
      if (STORAGE_FIELDS.has(name) && isStorageKey(inner)) continue;
      const kept = exportRecord(inner);
      if (kept !== undefined) out[name === '_id' ? 'id' : name] = kept;
    }
    return out;
  }
  if (typeof value === 'object') return String(value);
  return value;
}
