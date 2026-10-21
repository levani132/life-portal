'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { refreshAll } from '../lib/hooks';

/** How far the content must be pulled (after damping) before release refreshes. */
const ARM_AT = 64;
/** The content never follows the finger further than this. */
const MAX_PULL = 110;
/** How much of the finger's movement the content follows — the elastic feel. */
const DAMPING = 0.45;
/** Where the content rests, spinner turning, while the refresh runs. */
const HOLD_AT = 52;
/** Movement below this is a tap or a tremor, not a gesture. */
const INTENT = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * 9;

/**
 * Pull-to-refresh requires a fresh downward drag that starts at the top, followed by release
 * beyond the threshold. Scrolling or momentum reaching the top never starts a refresh.
 *
 * Everything is data the server owns, so "refresh" means revalidating the cache, never reloading
 * the document.
 *
 * Two touch-handling details matter (the same traps `sortable-grid` documents):
 * - The `touchmove` listener is registered **non-passive at mount**, because a browser that finds
 *   no cancellable listener at `touchstart` hands the gesture to the compositor and our
 *   `preventDefault` — which is what keeps iOS's own rubber band from fighting the pull — is
 *   silently ignored.
 * - A gesture already claimed by someone else (`defaultPrevented`, e.g. a card being dragged on
 *   the dashboard) is never also a pull.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const gesture = useRef({
    startX: 0,
    startY: 0,
    tracking: false,
    pulling: false,
    armed: false,
  });
  const refreshingRef = useRef(false);

  useEffect(() => {
    const g = gesture.current;

    const beginRefresh = () => {
      refreshingRef.current = true;
      setRefreshing(true);
      setPull(HOLD_AT);
      void refreshAll().finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      });
    };

    const onTouchStart = (event: TouchEvent) => {
      g.tracking = false;
      g.pulling = false;
      g.armed = false;
      if (refreshingRef.current) return;
      setPull(0);
      if (window.scrollY > 0) return;
      if (event.touches.length !== 1) return;
      // A touch inside something with its own vertical scrollbar — a sheet, a modal list —
      // belongs to that scroller, even when the page behind it sits at the top.
      if (ownsItsOwnScroll(event.target)) return;
      g.tracking = true;
      g.startX = event.touches[0].clientX;
      g.startY = event.touches[0].clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!g.tracking) return;
      if (event.defaultPrevented || event.touches.length !== 1) {
        cancelGesture();
        return;
      }
      const x = event.touches[0].clientX;
      const y = event.touches[0].clientY;

      if (!g.pulling) {
        if (window.scrollY > 0) {
          cancelGesture();
          return;
        }
        const dx = x - g.startX;
        const dy = y - g.startY;
        // Once this is an ordinary scroll or sideways swipe, it cannot turn into a pull.
        if (
          dy < -INTENT ||
          (Math.abs(dx) > INTENT && Math.abs(dx) > Math.abs(dy))
        ) {
          cancelGesture();
          return;
        }
        if (dy < INTENT) return;
        g.pulling = true;
      }

      // The non-passive registration below exists for exactly this call.
      event.preventDefault();

      const damped = Math.min(MAX_PULL, Math.max(0, (y - g.startY) * DAMPING));
      setPull(damped);

      const armed = damped >= ARM_AT;
      // One tick on crossing the threshold, like the feed apps — not a buzz per pixel.
      if (armed && !g.armed) navigator.vibrate?.(10);
      g.armed = armed;
    };

    const cancelGesture = () => {
      g.tracking = false;
      g.pulling = false;
      g.armed = false;
      if (!refreshingRef.current) setPull(0);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length !== 0) {
        cancelGesture();
        return;
      }
      if (!g.pulling) {
        g.tracking = false;
        return;
      }
      g.tracking = false;
      g.pulling = false;

      if (!g.armed) {
        setPull(0);
        return;
      }
      g.armed = false;
      beginRefresh();
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', cancelGesture);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', cancelGesture);
    };
  }, []);

  const progress = Math.min(1, pull / ARM_AT);

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center overflow-hidden"
        style={{ height: pull, opacity: refreshing ? 1 : progress }}
      >
        <RefreshRing progress={progress} spinning={refreshing} />
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          // Follows the finger raw; springs back through a transition once it lets go.
          transition: gesture.current.pulling
            ? 'none'
            : 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The indicator: an arc that fills and rotates with the pull — full circle exactly at the
 * threshold, so the drawing itself says when to let go — then spins while the refresh runs.
 */
function RefreshRing({
  progress,
  spinning,
}: {
  progress: number;
  spinning: boolean;
}) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      focusable="false"
      className={spinning ? 'animate-spin' : undefined}
      style={
        spinning
          ? undefined
          : { transform: `rotate(${progress * 270 - 90}deg)` }
      }
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="rgb(40 45 58)"
        strokeWidth="2.5"
      />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="rgb(56 189 248)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${RING_CIRCUMFERENCE}`}
        strokeDashoffset={
          RING_CIRCUMFERENCE * (1 - (spinning ? 0.3 : progress))
        }
      />
    </svg>
  );
}

/** Walks from the touch target to the body looking for an element that scrolls vertically. */
function ownsItsOwnScroll(start: EventTarget | null): boolean {
  let node = start instanceof Element ? start : null;
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return true;
    }
    node = node.parentElement;
  }
  return false;
}
