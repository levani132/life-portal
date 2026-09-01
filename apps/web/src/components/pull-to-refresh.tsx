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
/** Milliseconds of bounce per px/ms of arrival speed: how far a momentum flick overshoots. */
const BOUNCE_SCALE = 42;
/** Arrivals slower than this (in overshoot px) just stop; a bounce that small reads as jitter. */
const BOUNCE_MIN = 12;

const RING_CIRCUMFERENCE = 2 * Math.PI * 9;

/**
 * Pull-to-refresh, the way the feed apps do it: drag down at the top — or keep dragging after a
 * scroll reaches the top, in the same gesture — a ring fills as the pull approaches the
 * threshold, a small haptic tick says "armed" (where the platform has one — Android; iOS exposes
 * no web vibration API), and release refetches every SWR query on the page.
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
  const gesture = useRef({ startX: 0, startY: 0, tracking: false, pulling: false, armed: false });
  const refreshingRef = useRef(false);
  const touchActive = useRef(false);
  /** Recent (scrollY, time) samples, for the speed the page arrives at its top with. */
  const samples = useRef<{ y: number; t: number }[]>([]);
  /** One bounce per approach: re-armed only after the page has left the top again. */
  const bounceReady = useRef(false);
  const bounceTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const g = gesture.current;

    const beginRefresh = (holdOvershoot?: number) => {
      refreshingRef.current = true;
      setRefreshing(true);
      setPull(holdOvershoot ?? HOLD_AT);
      if (holdOvershoot !== undefined) {
        // Let the bounce overshoot, then settle where the spinner rests.
        bounceTimer.current = window.setTimeout(() => setPull(HOLD_AT), 220);
      }
      void refreshAll().finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      });
    };

    const onTouchStart = (event: TouchEvent) => {
      touchActive.current = true;
      window.clearTimeout(bounceTimer.current);
      g.tracking = false;
      g.pulling = false;
      g.armed = false;
      if (refreshingRef.current) return;
      if (event.touches.length !== 1) return;
      // A touch inside something with its own vertical scrollbar — a sheet, a modal list —
      // belongs to that scroller, even when the page behind it sits at the top.
      if (ownsItsOwnScroll(event.target)) return;
      // Starting below the top is fine: the drag that brings the page to its top flows straight
      // into the pull, the way the feed apps chain them — no lifting the finger in between.
      g.tracking = true;
      g.startX = event.touches[0].clientX;
      g.startY = event.touches[0].clientY;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!g.tracking) return;
      if (event.defaultPrevented) {
        g.tracking = false;
        return;
      }
      const x = event.touches[0].clientX;
      const y = event.touches[0].clientY;

      if (!g.pulling) {
        // While the page still has scroll to give, let it scroll — and keep re-basing the start
        // so the pull is measured from where the finger will be when the top arrives, with the
        // distance the scroll consumed already deducted. One continuous drag then turns into a
        // pull the moment the page runs out of top.
        if (window.scrollY > 0) {
          g.startX = x;
          g.startY = y + window.scrollY;
          return;
        }
        const dx = x - g.startX;
        const dy = y - g.startY;
        // Sideways is a table scroll or a swipe, and stays one for the rest of the touch. An
        // upward drag is an ordinary scroll — but remains a candidate, because the same finger
        // dragging back down past the top should still become a pull.
        if (dy < INTENT || Math.abs(dx) > Math.abs(dy)) {
          if (Math.abs(dx) > INTENT && Math.abs(dx) > Math.abs(dy)) g.tracking = false;
          return;
        }
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

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) touchActive.current = false;
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

    /**
     * The momentum bounce. With the browser's rubber band off, a flick used to stop dead at the
     * top; this recreates the bounce from the speed the page arrived with — and a flick hard
     * enough to carry the overshoot past the threshold goes straight into the refresh, the way
     * a native scroll view's bounce does. Finger-down arrivals are the touch handlers' business.
     */
    const onScroll = () => {
      const now = performance.now();
      const yNow = window.scrollY;
      const s = samples.current;
      s.push({ y: yNow, t: now });
      if (s.length > 6) s.shift();

      if (yNow > 60) {
        bounceReady.current = true;
        return;
      }
      if (yNow > 0 || !bounceReady.current) return;
      bounceReady.current = false;
      if (touchActive.current || refreshingRef.current || g.pulling) return;

      // Speed toward the top over the last ~120ms, in px per ms.
      const oldest = s.find((p) => now - p.t <= 120) ?? s[0];
      if (!oldest || now <= oldest.t) return;
      const speed = (oldest.y - yNow) / (now - oldest.t);
      if (speed <= 0) return;

      const overshoot = Math.min(MAX_PULL, speed * BOUNCE_SCALE);
      if (overshoot < BOUNCE_MIN) return;

      if (overshoot >= ARM_AT) {
        navigator.vibrate?.(10);
        beginRefresh(overshoot);
        return;
      }
      // Too slow for a refresh: just the bounce, out and back.
      setPull(overshoot);
      bounceTimer.current = window.setTimeout(() => setPull(0), 200);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('scroll', onScroll);
      window.clearTimeout(bounceTimer.current);
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
function RefreshRing({ progress, spinning }: { progress: number; spinning: boolean }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      focusable="false"
      className={spinning ? 'animate-spin' : undefined}
      style={spinning ? undefined : { transform: `rotate(${progress * 270 - 90}deg)` }}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="rgb(40 45 58)" strokeWidth="2.5" />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="rgb(56 189 248)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${RING_CIRCUMFERENCE}`}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - (spinning ? 0.3 : progress))}
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
