'use client';

import { useCallback, useState } from 'react';
import useSWR, { mutate as globalMutate, type SWRConfiguration } from 'swr';
import { api, ApiError } from './api';

/**
 * SWR bound to the API client.
 *
 * `revalidateOnFocus` is off: this dashboard's data changes when the user changes it, not
 * behind their back, and refetching everything on every tab switch would burn the Finnhub
 * rate limit for no benefit.
 */
export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, (key: string) => api.get<T>(key), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    ...config,
  });
}

/** Refetches every query whose key starts with `prefix`. */
export function revalidate(prefix: string): Promise<unknown> {
  return globalMutate((key) => typeof key === 'string' && key.startsWith(prefix));
}

/**
 * Refetches everything that a write could plausibly have changed.
 *
 * Cross-widget links mean a single edit ripples: changing the monthly repayment alters the
 * loan scenarios, the cash projection *and* the dashboard. Rather than track that graph,
 * writes revalidate the affected roots — cheap, and impossible to get subtly wrong.
 */
export function revalidateLinked(): Promise<unknown> {
  return globalMutate(
    (key) =>
      typeof key === 'string' &&
      ['/dashboard', '/loans', '/cashflow', '/items', '/stocks', '/personal', '/boards'].some((root) =>
        key.startsWith(root),
      ),
  );
}

/**
 * Wraps a write so components get `pending` and `error` without repeating try/catch.
 * Re-throws nothing: callers check `error` and the UI stays mounted.
 */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>, options?: { revalidate?: boolean }) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      if (options?.revalidate !== false) await revalidateLinked();
      return true;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, clearError: useCallback(() => setError(null), []) };
}
