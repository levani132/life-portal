'use client';

import clsx from 'clsx';
import { useRef, useState } from 'react';

export interface ScrubBar {
  key: string;
  value: number;
  /** False draws a stub: no data, which is not the same as zero. */
  present?: boolean;
  /** Under the bar; leave out to show no label for it. */
  axis?: string;
  /** The callout when the bar is touched, like Apple Health: the value, then when. */
  valueText: string;
  when: string;
}

/**
 * Bars you can read by touching (or pointing at) them: the touched bar stays bright, the others
 * dim and a callout above says its value. Dragging sideways moves along the bars; a vertical drag
 * still scrolls the page (`touch-action: pan-y`), and the gesture is never a tab swipe.
 */
export function ScrubBars({
  bars,
  max,
  barClass,
  label,
  className,
  interactive = true,
}: {
  bars: ScrubBar[];
  max?: number;
  /** A fill role, e.g. `bg-accent-solid/70`. */
  barClass: string;
  label: string;
  className?: string;
  interactive?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const most = Math.max(1, max ?? 0, ...bars.map((bar) => (bar.present === false ? 0 : bar.value)));
  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !bars.length) return;
    const index = rect.width ? Math.floor(((clientX - rect.left) / rect.width) * bars.length) : 0;
    setActive(Math.min(bars.length - 1, Math.max(0, index)));
  };
  const shown = active === null ? undefined : bars[active];
  const hasAxis = bars.some((bar) => bar.axis !== undefined);
  return (
    <div className={clsx('relative flex min-h-0 flex-col', className)}>
      {shown && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-surface-raised px-2 py-1 text-center shadow-lg ring-1 ring-border"
          style={{ left: `${Math.min(85, Math.max(15, ((active! + 0.5) / bars.length) * 100))}%` }}
          role="status"
        >
          <span className="block text-sm font-bold tabular">{shown.valueText}</span>
          <span className="block text-[10px] text-ink-muted">{shown.when}</span>
        </div>
      )}
      <div
        ref={box}
        role="img"
        aria-label={label}
        data-no-tab-swipe={interactive ? '' : undefined}
        className={clsx('flex min-h-0 flex-1 items-end gap-1.5', interactive && 'cursor-pointer select-none [touch-action:pan-y]')}
        onPointerDown={
          interactive
            ? (event) => {
                event.stopPropagation();
                pick(event.clientX);
              }
            : undefined
        }
        onPointerMove={interactive ? (event) => (event.pointerType === 'mouse' || event.buttons ? pick(event.clientX) : undefined) : undefined}
        onPointerLeave={interactive ? (event) => event.pointerType === 'mouse' && setActive(null) : undefined}
        onClick={interactive ? (event) => event.stopPropagation() : undefined}
      >
        {bars.map((bar, index) => {
          const present = bar.present !== false && bar.value > 0;
          return (
            <div key={bar.key} className="flex h-full flex-1 flex-col items-center justify-end">
              <span
                title={`${bar.when}: ${bar.valueText}`}
                className={clsx(
                  'w-full rounded-md transition-opacity',
                  present ? barClass : 'bg-border',
                  active !== null && active !== index && 'opacity-40',
                )}
                style={{ height: present ? `${Math.max(6, (bar.value / most) * 100)}%` : '4px' }}
              />
            </div>
          );
        })}
      </div>
      {hasAxis && (
        <div className="mt-1 flex gap-1.5" aria-hidden>
          {bars.map((bar, index) => (
            <span key={bar.key} className={clsx('flex-1 text-center text-[10px] leading-none', active === index ? 'font-semibold text-ink' : 'text-ink-faint')}>
              {bar.axis ?? ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Thu 26 Nov" for a `YYYY-MM-DD` day. */
export function barDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
