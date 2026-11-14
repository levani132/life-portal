import type { OutboxItem } from './types';

/**
 * Edits that clashed with another device (spec 030, issue #19), as the sync sheet shows them.
 * Pure: what was edited, how it differs from the row as the server has it now, and the write
 * that each choice turns it into. Nothing here sends anything (`lib/sync-conflicts.ts` does).
 *
 * The server refuses an edit made against an older version with `STALE_EDIT` and the current row,
 * and an edit of a row deleted elsewhere with `ROW_DELETED`. Nothing is ever merged on its own:
 * numbers are mine-or-theirs, text can be combined only through a preview the person confirms,
 * and a weigh-in from another device is never overwritten without a choice.
 */

export type EditKind = 'set' | 'exercise' | 'session' | 'entry' | 'weighin';

export interface Edit {
  kind: EditKind;
  /** The row this edit is about, e.g. `set:<id>`. Two edits of one row are sent in order. */
  rowKey: string;
  base?: number;
  /** The fields the person changed, as they set them. */
  patch: Record<string, unknown>;
  /** The free-text field of this kind of row, which may be combined rather than chosen. */
  textField: 'notes' | 'note' | undefined;
}

const KINDS: Record<string, EditKind> = {
  'training.set.patch': 'set',
  'training.exercise.patch': 'exercise',
  'training.session.patch': 'session',
  'nutrition.entry.patch': 'entry',
  'nutrition.weighin.put': 'weighin',
};

type Meta = Record<string, unknown> & { patch?: Record<string, unknown>; baseVersion?: number };

/** The edit an outbox item (or one about to be enqueued) makes, if it is a checked edit. */
export function editOf(item: Pick<OutboxItem, 'kind' | 'meta'>): Edit | undefined {
  const kind = KINDS[item.kind];
  const meta = item.meta as Meta | undefined;
  if (!kind || !meta) return undefined;
  const base = typeof meta.baseVersion === 'number' ? meta.baseVersion : undefined;
  switch (kind) {
    case 'set':
      return { kind, rowKey: `set:${meta['setId']}`, base, patch: meta.patch ?? {}, textField: undefined };
    case 'exercise':
      return { kind, rowKey: `exercise:${meta['workoutExerciseId']}`, base, patch: meta.patch ?? {}, textField: 'notes' };
    case 'session':
      return { kind, rowKey: `session:${meta['sessionId']}`, base, patch: meta.patch ?? {}, textField: 'notes' };
    case 'entry':
      return { kind, rowKey: `entry:${meta['entryId']}`, base, patch: meta.patch ?? {}, textField: 'note' };
    case 'weighin': {
      const { weightGrams, bodyFatPct, note } = meta;
      return {
        kind,
        rowKey: `weighin:${meta['day']}`,
        base,
        patch: { weightGrams, bodyFatPct, ...(note != null ? { note } : {}) },
        textField: undefined,
      };
    }
  }
}

export type Conflict =
  | { type: 'stale'; edit: Edit; theirs: Record<string, unknown>; version: number }
  | { type: 'deleted'; edit: Edit };

/** The clash an item is waiting on, if any. */
export function conflictOf(item: OutboxItem): Conflict | undefined {
  if (item.state !== 'conflict') return undefined;
  const edit = editOf(item);
  if (!edit) return undefined;
  if (item.lastErrorCode === 'ROW_DELETED') return { type: 'deleted', edit };
  if (item.lastErrorCode !== 'STALE_EDIT' || !item.lastErrorCurrent) return undefined;
  // A set comes back as `{ set, records }`.
  const current = item.lastErrorCurrent;
  const theirs = (edit.kind === 'set' && current['set'] && typeof current['set'] === 'object' ? current['set'] : current) as Record<
    string,
    unknown
  >;
  return { type: 'stale', edit, theirs, version: typeof theirs['version'] === 'number' ? theirs['version'] : 0 };
}

const LABELS: Record<string, string> = {
  reps: 'Reps',
  weightGrams: 'Weight',
  assistGrams: 'Assistance',
  durationSeconds: 'Time',
  distanceMeters: 'Distance',
  rpe: 'RPE',
  restSeconds: 'Rest',
  type: 'Set type',
  skipped: 'Skipped',
  superset: 'Superset',
  notes: 'Notes',
  note: 'Note',
  day: 'Day',
  slot: 'Meal',
  amount: 'Amount',
  bodyFatPct: 'Body fat',
};

function show(field: string, value: unknown, row: Record<string, unknown>): string {
  if (value === undefined || value === null || value === '') return '—';
  if (field === 'weightGrams' || field === 'assistGrams') return `${Number(value) / 1000} kg`;
  if (field === 'durationSeconds' || field === 'restSeconds') return `${value} s`;
  if (field === 'distanceMeters') return `${value} m`;
  if (field === 'bodyFatPct') return `${Math.round(Number(value) * 1000) / 10}%`;
  if (field === 'amount') return `${value} ${String(row['unit'] ?? '')}`.trim();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export interface FieldDiff {
  field: string;
  label: string;
  mine: string;
  theirs: string;
  /** The free-text field: offered for combining. */
  text: boolean;
}

/** What differs between this device's edit and the row as the server has it, field by field. */
export function diffFields(conflict: Extract<Conflict, { type: 'stale' }>): FieldDiff[] {
  const { edit, theirs } = conflict;
  return Object.entries(edit.patch)
    .filter(([field]) => field !== 'baseVersion')
    .map(([field, value]) => ({
      field,
      label: LABELS[field] ?? field,
      mine: show(field, value, theirs),
      theirs: show(field, theirs[field], theirs),
      text: field === edit.textField,
    }))
    .filter((diff) => diff.mine !== diff.theirs || edit.kind === 'weighin');
}

/** The starting point of a combined note: theirs, then mine. Edited and confirmed by the person. */
export function combinedText(theirs: unknown, mine: unknown): string {
  const parts = [theirs, mine].map((part) => (typeof part === 'string' ? part.trim() : '')).filter(Boolean);
  return [...new Set(parts)].join('\n\n');
}

/** The same write made against `base` (and with `patch` changes), for "keep mine" or a combined note. */
export function rebased(
  item: Pick<OutboxItem, 'body' | 'meta'>,
  base: number,
  patch: Record<string, unknown> = {},
): { body: unknown; meta: unknown } {
  const meta = { ...(item.meta as Meta), baseVersion: base };
  if (meta.patch) meta.patch = { ...meta.patch, ...patch };
  else Object.assign(meta, patch);
  return { body: { ...(item.body as Record<string, unknown>), ...patch, baseVersion: base }, meta };
}

/** Earlier checked edits of the same row still on the device: a new edit of it waits for them. */
export function earlierEditsOf(items: readonly OutboxItem[], next: Pick<OutboxItem, 'kind' | 'meta'>): string[] {
  const key = editOf(next)?.rowKey;
  if (!key) return [];
  return items.filter((item) => editOf(item)?.rowKey === key).map((item) => item.id);
}

/** Later edits of the same row that were made on top of `item`, in order. */
export function laterEditsOf(items: readonly OutboxItem[], item: OutboxItem): OutboxItem[] {
  const key = editOf(item)?.rowKey;
  if (!key) return [];
  return items.filter((other) => other.seq > item.seq && editOf(other)?.rowKey === key).sort((a, b) => a.seq - b.seq);
}
