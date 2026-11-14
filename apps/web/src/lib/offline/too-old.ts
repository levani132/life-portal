import type { OutboxItem } from './types';

/**
 * A workout recorded offline more than 14 days before it reached the server (spec 034, issue
 * #21). The server refuses it with `CLIENT_TIME_TOO_OLD` rather than moving it. The person may
 * save it with today's date instead: shown both times and confirmed, the whole workout moves so
 * that it ends now, and its sets and finish keep their spacing. Pure.
 */

export const CLIENT_TIME_TOO_OLD = 'CLIENT_TIME_TOO_OLD';

type Times = { startedAt?: string; loggedAt?: string; endedAt?: string };
type SessionMeta = Times & { op?: string; sessionId?: string; day?: string };

/** The refused start and the time it was recorded at, if `item` is one. */
export function tooOldStart(item: Pick<OutboxItem, 'kind' | 'state' | 'lastErrorCode' | 'body'>): { recordedAt: string } | undefined {
  if (item.kind !== 'training.start' || item.state !== 'error' || item.lastErrorCode !== CLIENT_TIME_TOO_OLD) return undefined;
  const recordedAt = (item.body as Times | undefined)?.startedAt;
  return recordedAt ? { recordedAt } : undefined;
}

export interface MovedWrite {
  id: string;
  body: unknown;
  meta: unknown;
}

const FIELDS = ['startedAt', 'loggedAt', 'endedAt'] as const;

function shifted<T extends Times>(value: T | undefined, deltaMs: number): T | undefined {
  if (!value || typeof value !== 'object') return value;
  const next: T = { ...value };
  for (const field of FIELDS) {
    const at = value[field];
    if (typeof at === 'string' && Number.isFinite(Date.parse(at)))
      next[field] = new Date(Date.parse(at) + deltaMs).toISOString();
  }
  return next;
}

/**
 * The workout's waiting writes with every recorded time moved by the same amount, so the latest
 * one lands on `nowIso`; the start also gets `day`. Dependents first, start last: a dependent
 * is never sent before its start is accepted, so none can go out with the old times.
 */
export function movedToToday(
  items: readonly Pick<OutboxItem, 'id' | 'kind' | 'body' | 'meta'>[],
  start: Pick<OutboxItem, 'id' | 'body' | 'meta'>,
  nowIso: string,
  day: string,
): { startedAt: string; writes: MovedWrite[] } | undefined {
  const sessionId = (start.meta as SessionMeta | undefined)?.sessionId;
  const recorded = Date.parse((start.body as Times | undefined)?.startedAt ?? '');
  if (!sessionId || !Number.isFinite(recorded)) return undefined;
  const mine = items.filter(
    (item) => item.id !== start.id && item.kind.startsWith('training.') && (item.meta as SessionMeta | undefined)?.sessionId === sessionId,
  );
  let latest = recorded;
  for (const item of mine)
    for (const field of FIELDS) {
      const at = Date.parse((item.body as Times | undefined)?.[field] ?? '');
      if (Number.isFinite(at)) latest = Math.max(latest, at);
    }
  const delta = Date.parse(nowIso) - latest;
  const startedAt = new Date(recorded + delta).toISOString();
  const writes: MovedWrite[] = mine
    .filter((item) => FIELDS.some((field) => typeof (item.body as Times | undefined)?.[field] === 'string'))
    .map((item) => ({ id: item.id, body: shifted(item.body as Times, delta), meta: shifted(item.meta as Times, delta) }));
  writes.push({
    id: start.id,
    body: { ...(start.body as object), startedAt, day },
    meta: { ...(start.meta as object), startedAt, day },
  });
  return { startedAt, writes };
}
