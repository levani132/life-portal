'use client';

import type { ReactNode } from 'react';
import { loadErrorKind, loadErrorMessage, type LoadErrorKind } from '../lib/load-error';

/**
 * Issue #34: a read that failed, said for what it was (offline, unreachable, a server error), with
 * a way to try again. `LoadProblem` stands in for a screen with nothing to show; `LoadProblemBar`
 * sits above content that is still on screen from the last good read, so a failed refresh never
 * blanks what was already loaded.
 */
const HINT: Partial<Record<LoadErrorKind, string>> = {
  offline: 'It reads again by itself once you’re back online.',
  unreachable: 'Trying again by itself.',
  server: 'Trying again by itself.',
};

export function LoadProblem({ error, onRetry, children }: { error: unknown; onRetry: () => void; children?: ReactNode }) {
  const kind = loadErrorKind(error);
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-4 text-sm">
      <p className="font-medium text-rose-200">{loadErrorMessage(kind, error)}</p>
      {HINT[kind] && <p className="mt-1 text-rose-200/80">{HINT[kind]}</p>}
      {children}
      <button type="button" className="btn mt-3" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function LoadProblemBar({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = loadErrorKind(error);
  return (
    <div role="status" className="mb-3 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
      <span className="flex-1">{loadErrorMessage(kind, error)} Showing what was last loaded.</span>
      <button type="button" className="shrink-0 underline" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
