import { useSyncExternalStore } from 'react';
import { offlineCache, waitForOfflineCache } from './offline/runtime';

/**
 * Issue #32: what was typed into set rows not yet ticked, kept so that leaving the workout
 * (another tab, a reload, the app closed) never loses it. Rows not yet ticked are not data
 * (nothing is sent until the tick), so they live only on this device: in memory for an instant
 * remount, and in the training cache (spec 027 allows training on the device) for a reload. One
 * entry per workout, keyed by the workout's exercise row, cleared when the workout is finished
 * or deleted, and with everything else on sign-out.
 */
export interface SetDraft<F = unknown> {
  /** Typed values by set position (0-based, counting logged sets). */
  edits: Record<number, F>;
  /** Rows added (+) or removed (−) relative to what the exercise starts with. */
  extra: number;
}
type WorkoutDrafts = Record<string, SetDraft>;

const memory = new Map<string, WorkoutDrafts>();

// What depends on the rows a person added or removed (which exercise is done, the n/m chip)
// re-reads when a draft changes.
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

/** Re-renders the caller whenever any kept draft changes. */
export function useDraftsVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => 0,
  );
}

/** Rows added (+) or removed (−) to an exercise in this workout, beyond what it started with. */
export function extraRows(sessionId: string, exerciseId: string): number {
  return memory.get(sessionId)?.[exerciseId]?.extra ?? 0;
}
const keyOf = (sessionId: string) => `training:draft:${sessionId}`;

/** What is already in memory, for a synchronous first render. */
export function draftNow<F>(sessionId: string, exerciseId: string): SetDraft<F> | undefined {
  return memory.get(sessionId)?.[exerciseId] as SetDraft<F> | undefined;
}

/** The kept draft, from memory or the device. */
export async function loadDraft<F>(sessionId: string, exerciseId: string): Promise<SetDraft<F> | undefined> {
  const now = draftNow<F>(sessionId, exerciseId);
  if (now) return now;
  const cache = await waitForOfflineCache().catch(() => undefined);
  const stored = await cache?.get<WorkoutDrafts>(keyOf(sessionId)).catch(() => undefined);
  if (!stored) return undefined;
  // Another exercise may have saved into memory meanwhile: what is in memory is newer.
  memory.set(sessionId, { ...stored, ...memory.get(sessionId) });
  changed();
  return draftNow<F>(sessionId, exerciseId);
}

const empty = (draft: SetDraft) => draft.extra === 0 && Object.keys(draft.edits).length === 0;

export function saveDraft<F>(sessionId: string, exerciseId: string, draft: SetDraft<F>): void {
  const drafts = { ...memory.get(sessionId) };
  if (empty(draft)) delete drafts[exerciseId];
  else drafts[exerciseId] = draft;
  memory.set(sessionId, drafts);
  changed();
  const cache = offlineCache();
  if (!cache) return;
  void (Object.keys(drafts).length ? cache.put(keyOf(sessionId), drafts) : cache.remove(keyOf(sessionId))).catch(() => undefined);
}

/** The workout is over (finished or deleted): nothing typed in it is needed any more. */
export function clearDrafts(sessionId: string): void {
  memory.delete(sessionId);
  changed();
  void offlineCache()?.remove(keyOf(sessionId)).catch(() => undefined);
}

/** Sign-out (the device copy goes with the account's store), and tests. */
export function forgetDraftsInMemory(): void {
  memory.clear();
  changed();
}
