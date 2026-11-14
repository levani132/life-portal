'use client';

import { useEffect, useState } from 'react';
import { NetworkError } from '../api';
import { offlineCache, useOfflineAccount } from './runtime';

/**
 * A read that still has something to show without a connection (spec 027). Every successful
 * answer is kept under `key` (an allowlisted cache key, so money data cannot be), and when the
 * request gets no answer at all the kept copy is returned with `offlineCopy: true`, for the UI to
 * label. A refusal from the server (any `ApiError`) is not hidden behind an old copy.
 */
export function useOfflineCopy<T>(key: string, result: { data?: T; error?: unknown }): { data?: T; offlineCopy: boolean; looking: boolean } {
  const account = useOfflineAccount();
  const [copy, setCopy] = useState<{ account: string; value: T } | undefined>();
  const [looked, setLooked] = useState<string | null>(null);

  useEffect(() => {
    const cache = offlineCache();
    if (!account || !cache || result.data === undefined) return;
    void cache.put(key, result.data).catch(() => undefined);
  }, [account, key, result.data]);

  const unreachable = result.error instanceof NetworkError;
  useEffect(() => {
    const cache = offlineCache();
    if (!account || !cache || !unreachable) return;
    let live = true;
    void cache
      .get<T>(key)
      .then((value) => {
        if (live && value !== undefined) setCopy({ account, value });
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLooked(account);
      });
    return () => {
      live = false;
    };
  }, [account, key, unreachable]);

  if (result.data !== undefined) return { data: result.data, offlineCopy: false, looking: false };
  // Never another account's copy, even for one render.
  if (unreachable && copy && copy.account === account) return { data: copy.value, offlineCopy: true, looking: false };
  // No answer and the device not yet checked: worth a moment before showing an error.
  const looking = unreachable && !!account && looked !== account;
  return { data: undefined, offlineCopy: false, looking };
}
