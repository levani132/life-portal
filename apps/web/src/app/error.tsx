'use client';

import { useEffect } from 'react';
import { reportError } from '../lib/error-reporting';

/**
 * What a person sees when a page crashes while drawing: a plain message and a way to try again,
 * inside the shell, so the tabs still work. The crash is reported to the error log.
 */
export default function PageError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center" role="alert">
      <h1 className="text-lg font-bold">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-ink-muted">It has been reported. Your data is safe: nothing was changed by this.</p>
      <button type="button" className="btn-primary mt-5" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
