'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '../../lib/training';

/**
 * Counts down from the last logged set. Client-only: nothing about it is stored. It reads the
 * clock here, for display; no figure the API keeps depends on it.
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <span className={left <= 0 ? 'font-medium text-emerald-400' : 'text-ink-muted'}>
        {left > 0 ? `Rest ${formatDuration(left)}` : 'Rest over: next set'}
      </span>
      <button type="button" className="text-xs text-ink-faint hover:text-ink" onClick={() => setDismissedFor(since)}>
        Hide
      </button>
    </div>
  );
}
