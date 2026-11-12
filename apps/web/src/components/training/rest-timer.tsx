'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '../../lib/training';
import { restLeft, useRestControls } from '../../lib/training-workout';

/**
 * Counts down from the last logged set. Client-only: nothing about it is stored. It reads the
 * clock here, for display; no figure the API keeps depends on it.
 *
 * It sticks under the app header while you scroll the workout (issue #4). It is one element that
 * is `position: sticky`, never a second copy, so the countdown keeps its state and no duplicate
 * can appear. It sits at `--header-offset` (published by the header) on a solid band; with no
 * header showing it fills the safe-area band itself (`--header-band`) rather than leave the iOS
 * status bar hollow. Keep it a direct child of the workout's list, not inside a card: a sticky
 * element only sticks within its parent.
 *
 * Spec 025: −15 s / +15 s change this rest only, and Skip ends it (it used to say Hide). Both
 * are shared with the pinned workout bar through `useRestControls`. Mid-way through a superset
 * round there is no rest (`seconds` is 0) and it says which exercise to go to instead.
 */
export function RestTimer({ since, seconds, next }: { since?: string; seconds: number; next?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const controls = useRestControls(since);
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);

  const band = (children: React.ReactNode) => (
    <div
      data-testid="rest-timer"
      className="sticky top-[var(--header-offset,0px)] z-30 -mx-4 bg-surface px-4 pb-2 pt-[calc(var(--header-band,var(--top-chrome))+0.5rem)]"
    >
      {children}
    </div>
  );

  const fresh = since !== undefined && now - Date.parse(since) < 60_000;
  if (seconds <= 0) {
    if (!since || !next || !fresh || controls.skipped) return null;
    return band(
      <div role="status" className="rounded-xl border border-train-pull/30 bg-train-pull/10 px-3 py-2 text-sm">
        <span className="font-semibold text-train-pull">Superset: straight on to {next}</span>
      </div>,
    );
  }

  const left = restLeft(since, seconds, controls, now);
  if (left === undefined) return null;
  const total = seconds + controls.addSeconds;
  const step = 'rounded-lg px-2 py-1 text-xs font-semibold tabular-nums text-ink-muted transition-colors hover:bg-surface hover:text-ink';
  return band(
    <div
      role="timer"
      aria-label="Rest timer"
      className={
        left > 0
          ? 'rounded-xl border border-train-pull/30 bg-train-pull/10 px-3 py-2 text-sm'
          : 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className={left <= 0 ? 'min-w-0 truncate font-semibold text-emerald-400' : 'min-w-0 truncate font-semibold text-train-pull'}>
          {left > 0 ? `Rest ${formatDuration(left)}` : 'Rest over'}
          {next && <span className="font-normal text-ink-muted"> · next {next}</span>}
        </span>
        <div className="-mr-1 flex shrink-0 items-center">
          {left > 0 && (
            <>
              <button type="button" className={step} onClick={() => controls.adjust(-15)} aria-label="15 seconds less rest">
                −15s
              </button>
              <button type="button" className={step} onClick={() => controls.adjust(15)} aria-label="15 seconds more rest">
                +15s
              </button>
            </>
          )}
          <button type="button" className={step} onClick={controls.skip}>
            {left > 0 ? 'Skip' : 'Dismiss'}
          </button>
        </div>
      </div>
      {left > 0 && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-train-pull/15">
          <div
            className="h-full rounded-full bg-train-pull-solid transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
            style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }}
          />
        </div>
      )}
    </div>,
  );
}
