'use client';

import type { SessionExercise, SetPatch } from '@life-portal/shared-types';
import { revalidate } from './hooks';
import { foodWrites } from './nutrition-offline';
import { conflictOf, laterEditsOf, rebased, type Conflict } from './offline/conflicts';
import type { NutritionWriteMeta } from './offline/nutrition-overlay';
import { outbox, outboxItems } from './offline/runtime';
import type { TrainingWriteMeta } from './offline/training-overlay';
import type { OutboxItem } from './offline/types';
import { trainingWrites } from './training-offline';

/**
 * The choices the sync sheet offers for an edit that clashed with another device (spec 030,
 * issue #19). Each is explicit: the person pressed it. See `offline/conflicts.ts`.
 */

const refetch = () => Promise.all([revalidate('/training'), revalidate('/nutrition'), revalidate('/dashboard')]);

/** Sends the item again against `base`, and the edits made on top of it against what it will produce. */
async function resend(item: OutboxItem, base: number, patch: Record<string, unknown> = {}) {
  const later = laterEditsOf(outboxItems(), item);
  await outbox.replace(item.id, { id: crypto.randomUUID(), ...rebased(item, base, patch) });
  for (const [index, next] of later.entries()) {
    await outbox.replace(next.id, { id: crypto.randomUUID(), ...rebased(next, base + index + 1) });
  }
}

/** A weigh-in decided one way can be put back the other way, as a new edit. */
export type Undo = () => Promise<void>;

function weighInUndo(item: OutboxItem, values: Record<string, unknown>, base: number): Undo {
  const meta = item.meta as Extract<NutritionWriteMeta, { op: 'weighin.put' }>;
  return () =>
    foodWrites.putWeighIn(
      {
        day: meta.day,
        weightGrams: Number(values['weightGrams']),
        ...(values['bodyFatPct'] != null ? { bodyFatPct: Number(values['bodyFatPct']) } : {}),
        ...(typeof values['note'] === 'string' ? { note: values['note'] } : {}),
      },
      { version: base },
    );
}

/** Mine wins: the edit is sent again against the row as it is now. */
export async function keepMine(item: OutboxItem): Promise<Undo | undefined> {
  const conflict = conflictOf(item);
  if (conflict?.type !== 'stale') return undefined;
  await resend(item, conflict.version);
  return conflict.edit.kind === 'weighin' ? weighInUndo(item, conflict.theirs, conflict.version + 1) : undefined;
}

/** Theirs wins: this edit, and any made on top of it here, are dropped. */
export async function keepTheirs(item: OutboxItem): Promise<Undo | undefined> {
  const conflict = conflictOf(item);
  await outbox.discard(item.id);
  await refetch();
  return conflict?.type === 'stale' && conflict.edit.kind === 'weighin'
    ? weighInUndo(item, conflict.edit.patch, conflict.version)
    : undefined;
}

/** The note the person combined and confirmed, saved over theirs. */
export async function saveCombined(item: OutboxItem, text: string): Promise<void> {
  const conflict = conflictOf(item);
  if (conflict?.type !== 'stale' || !conflict.edit.textField) return;
  await resend(item, conflict.version, { [conflict.edit.textField]: text });
}

/** Whether a row deleted elsewhere can be added again with this device's change. */
export function canLogAgain(conflict: Conflict): boolean {
  if (conflict.type !== 'deleted') return false;
  return conflict.edit.kind === 'weighin' || conflict.edit.kind === 'entry' || conflict.edit.kind === 'set';
}

/**
 * A row deleted on another device, added again with this device's change, as a new row. The
 * refused edit goes first: an edit of the same row waits for it, and discarding takes those too.
 */
export async function logAgain(item: OutboxItem): Promise<void> {
  const meta = item.meta as TrainingWriteMeta | NutritionWriteMeta;
  await outbox.discard(item.id);
  if (meta.op === 'weighin.put') {
    const { op: _op, baseVersion: _base, ...input } = meta;
    await foodWrites.putWeighIn(input, { version: 0 });
  } else if (meta.op === 'entry.patch' && meta.was) {
    await foodWrites.logAgain(meta.was, meta.patch);
  } else if (meta.op === 'set.patch' && meta.was) {
    const patch = Object.fromEntries(Object.entries(meta.patch as SetPatch).filter(([, value]) => value != null));
    await trainingWrites.logSet(
      meta.sessionId,
      { id: meta.was.workoutExerciseId, snapshot: { name: 'logged again' } } as Pick<SessionExercise, 'id' | 'snapshot'>,
      { ...meta.was.value, ...patch },
    );
  }
  await refetch();
}
