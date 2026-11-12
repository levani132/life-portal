'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '../../lib/training';

/**
 * Counts down from the last logged set. Client-only: nothing about it is stored. It reads the
 * clock here, for display; no figure the API keeps depends on it.
 *
 * It sticks under the app header while you scroll the workout (issue #4). It is one element that
 * is `position: sticky`, never a second copy, so the countdown and Hide keep their state and no
 * duplicate can appear. It sits at `--header-offset` (published by the header) on a solid band;
 * with no header showing it fills the safe-area band itself (`--header-band`) rather than leave
 * the iOS status bar hollow. Keep it a direct child of the workout's list, not inside a card: a
 * sticky element only sticks within its parent.
 */
export function RestTimer({ since, seconds }: { since?: string; seconds: number }) {
  const [now, setNow] = useState(() => Date.now());
  const [dismissedFor, setDismissedFor] = useState<string | undefined>();
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);

  if (!since || seconds <= 0 || dismissedFor === since) return null;
  const elapsed = Math.floor((now - Date.parse(since)) / 1000);
  if (elapsed < 0 || elapsed > seconds + 60) return null;
  const left = seconds - elapsed;
  return (
    <div
      data-testid="rest-timer"
      className="sticky top-[var(--header-offset,0px)] z-30 -mx-4 bg-surface px-4 pb-2 pt-[calc(var(--header-band,var(--top-chrome))+0.5rem)]"
    >
      <div
        role="timer"
        aria-label="Rest timer"
        className={
          left > 0
            ? 'rounded-xl border border-train-pull/30 bg-train-pull/10 px-3 py-2 text-sm'
            : 'rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm'
        }
      >
        <div className="flex items-center justify-between gap-3">
          <span className={left <= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-train-pull'}>
            {left > 0 ? `Rest ${formatDuration(left)}` : 'Rest over: next set'}
          </span>
          <button type="button" className="text-xs text-ink-faint hover:text-ink" onClick={() => setDismissedFor(since)}>
            Hide
          </button>
        </div>
        {left > 0 && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-train-pull/15">
            <div
              className="h-full rounded-full bg-train-pull-solid transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
              style={{ width: `${Math.max(0, Math.min(100, (left / seconds) * 100))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
