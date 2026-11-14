'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { onWriteDone, useOutbox } from './runtime';
import type { OutboxItem } from './types';

/**
 * One module's writes as its screens should apply them (specs 028 and 029): everything still on
 * the device except writes the server refused, then the ones the server has acknowledged but
 * whose refetch has not landed yet ("settling"). Keeping those applied until the fresh copy
 * arrives is what lets the saved row replace the local one with no flicker and no double.
 *
 * `kindPrefix` is the outbox kind prefix (`training.`, `nutrition.`); `refetch` reloads that
 * module's reads after a write is acknowledged.
 */
export function moduleWrites(
  kindPrefix: string,
  refetch: (item: OutboxItem, result: unknown) => Promise<unknown>,
) {
  let settling: OutboxItem[] = [];
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const owns = (item: OutboxItem) => item.kind.startsWith(kindPrefix);

  if (typeof window !== 'undefined') {
    onWriteDone((item, result) => {
      if (!owns(item)) return;
      settling = [...settling, item];
      publish();
      void refetch(item, result)
        .catch(() => undefined)
        .finally(() => {
          settling = settling.filter((other) => other.id !== item.id);
          publish();
        });
    });
  }

  /** The items to apply, in order: waiting or conflicted ones, then settling ones. */
  function useItems(): OutboxItem[] {
    const snapshot = useOutbox();
    const settled = useSyncExternalStore(subscribe, () => settling, () => settling);
    return useMemo(() => {
      const live = snapshot.items.filter((item) => owns(item) && item.state !== 'error');
      const ids = new Set(live.map((item) => item.id));
      return [...live, ...settled.filter((item) => !ids.has(item.id))];
    }, [snapshot, settled]);
  }

  return { owns, useItems };
}
