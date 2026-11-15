'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** The collapse and expand time. Short enough never to be in the way of the next tap. */
export const COLLAPSE_MS = 220;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Content that folds away instead of vanishing (issue #24). Its height animates between 0 and
 * its natural height (a grid row from `0fr` to `1fr`, so nothing is measured) with a fade, and it
 * stays mounted until it has closed. It never blocks a tap: a new `open` simply reverses it.
 * With `prefers-reduced-motion` it opens and closes at once. A scroll anchor around it
 * (`useScrollAnchor`) keeps the page still while it moves.
 */
export function Collapsible({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      if (reducedMotion()) {
        setShown(true);
        return;
      }
      // Mounted closed first, then opened on the next frame, so the height can animate.
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    if (reducedMotion()) {
      setMounted(false);
      return;
    }
    timer.current = setTimeout(() => setMounted(false), COLLAPSE_MS + 50);
    return () => clearTimeout(timer.current);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      className={clsx(
        'grid transition-[grid-template-rows,opacity] ease-out motion-reduce:transition-none',
        shown ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
      style={{ transitionDuration: `${COLLAPSE_MS}ms` }}
      aria-hidden={shown ? undefined : true}
      inert={shown ? undefined : true}
      data-testid="collapsible"
      data-state={shown ? 'open' : 'closed'}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
