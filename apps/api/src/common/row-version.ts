import { ConflictException } from '@nestjs/common';

/**
 * Row versions (spec 030, issue #19): how two devices editing the same row never silently lose an
 * edit.
 *
 * Every row a person can edit from a device (a set, a workout exercise, a workout, a meal, a
 * weigh-in) carries `version`, a counter bumped by every edit (`$inc`). A row stored before this
 * existed has none, which reads as 0. A device sends the version it last saw as `baseVersion`; if
 * the row has moved on, the edit is refused with 409 `STALE_EDIT` and the row as it is now, and
 * the person chooses. A request without `baseVersion` (older clients, the MCP tools, Shortcuts)
 * is not checked, as before.
 *
 * The version counts edits to what the person typed. Server bookkeeping that cannot clash with an
 * edit (reordering, finishing, a plan update's markers) does not bump it, so it never turns an
 * unrelated change into a conflict.
 */

/** The stored counter as a number: missing is 0. */
export const versionOf = (row: { version?: number | null } | null | undefined): number => row?.version ?? 0;

/** A filter fragment matching a row still at `base` (missing counts as 0). Empty when unchecked. */
export function atVersion(base: number | undefined): Record<string, unknown> {
  if (base === undefined) return {};
  return base === 0 ? { version: { $in: [0, null] } } : { version: base };
}

/** The update fragment every edit carries. */
export const BUMP = { $inc: { version: 1 } } as const;

/** 409 `STALE_EDIT`: the row changed elsewhere since this device saw it. Carries it as it is now. */
export function staleEdit(current: unknown): ConflictException {
  return new ConflictException({
    code: 'STALE_EDIT',
    message: 'This was changed on another device. Choose which version to keep.',
    current,
  });
}

/** 409 `ROW_DELETED`: an edit to a row deleted elsewhere. Recoverable: discard, or add it again. */
export function rowDeleted(): ConflictException {
  return new ConflictException({
    code: 'ROW_DELETED',
    message: 'This was deleted on another device.',
  });
}

/**
 * Checks `baseVersion` against the row before an edit. A missing row is 404 for an unchecked
 * edit (as before) and `ROW_DELETED` for a checked one: the device saw the row, so it existed.
 */
export async function assertBase<T extends { version?: number | null }>(
  row: T | null,
  base: number | undefined,
  present: (row: T) => unknown,
  notFound: () => Error,
): Promise<T> {
  if (!row) throw base === undefined ? notFound() : rowDeleted();
  if (base !== undefined && versionOf(row) !== base) throw staleEdit(await present(row));
  return row;
}
