import type { OutboxItem, OutboxState } from './types';

/**
 * Versions of what the offline layer stores (spec 034, issue #21). The IndexedDB version
 * (`idb-store.ts`) covers stores and indexes; `schema` on each record covers its shape.
 *
 * An outbox item is the person's unsent work, so it is never dropped for being old or odd:
 * - written by this version (or before `schema` existed): used as it is;
 * - older, with a migration below: migrated in memory (and saved migrated when next updated);
 * - anything else (a newer app wrote it, or it fails the shape check): `incompatible`. It is never
 *   sent and never rewritten; the stored record stays exactly as it was, so a later version can
 *   still send it. The person may discard it, with a confirmation.
 *
 * A cached read is only a copy of what the server has: one of another schema is dropped and
 * fetched again.
 */

export const OUTBOX_SCHEMA = 1;
export const CACHE_SCHEMA = 1;

/** `MIGRATIONS[n]` turns a schema-n record into schema n+1. None yet: schema 1 is the first. */
export const MIGRATIONS: Record<number, (record: Record<string, unknown>) => Record<string, unknown>> = {};

const STATES: readonly OutboxState[] = ['pending', 'error', 'conflict', 'auth', 'held'];
const METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function wellFormed(record: Record<string, unknown>): boolean {
  return (
    typeof record['id'] === 'string' &&
    typeof record['kind'] === 'string' &&
    typeof record['path'] === 'string' &&
    METHODS.includes(record['method'] as string) &&
    STATES.includes(record['state'] as OutboxState) &&
    typeof record['seq'] === 'number' &&
    typeof record['createdAt'] === 'number' &&
    typeof record['attempts'] === 'number' &&
    typeof record['nextAttemptAt'] === 'number'
  );
}

/** What this version makes of a stored outbox record. Pure; never throws. */
export function readOutboxRecord(raw: unknown, schema = OUTBOX_SCHEMA, migrations = MIGRATIONS): OutboxItem {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let version = typeof record['schema'] === 'number' ? (record['schema'] as number) : 1;
  let current: Record<string, unknown> | undefined = record;
  try {
    while (current && version < schema) {
      const migrate: ((record: Record<string, unknown>) => Record<string, unknown>) | undefined = migrations[version];
      current = migrate ? migrate(current) : undefined;
      version += 1;
    }
  } catch {
    current = undefined;
  }
  if (current && version === schema && wellFormed(current)) return { ...(current as unknown as OutboxItem), schema };
  return incompatible(record);
}

/** The in-memory stand-in for a record this version cannot read. The stored one is untouched. */
function incompatible(record: Record<string, unknown>): OutboxItem {
  const text = (key: string, fallback: string) => (typeof record[key] === 'string' ? (record[key] as string) : fallback);
  const number = (key: string) => (typeof record[key] === 'number' ? (record[key] as number) : 0);
  return {
    id: text('id', ''),
    seq: number('seq'),
    kind: text('kind', 'unknown'),
    method: 'POST',
    path: text('path', ''),
    label: text('label', 'A change saved by another version of the app'),
    state: 'incompatible',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: number('createdAt'),
    ...(Array.isArray(record['dependsOn']) ? { dependsOn: (record['dependsOn'] as unknown[]).filter((id): id is string => typeof id === 'string') } : {}),
    ...(typeof record['schema'] === 'number' ? { schema: record['schema'] as number } : {}),
  };
}
