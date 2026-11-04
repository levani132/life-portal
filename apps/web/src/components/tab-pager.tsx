'use client';

import { useRouter } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { isStandalone } from '../lib/push';

/** A tab root the pager can show beside the current one. */
export interface PagerTab {
  href: string;
  Content: ComponentType;
  /** The `<main>` classes that tab uses, so its preview lines up with the real page exactly. */
  mainClass: string;
}

/** Movement below this is a tap or a tremor, not a gesture (Android's touch slop is ~8dp). */
const SLOP = 10;
/** Sideways must clearly beat vertical to count as a swipe, so a slanted scroll stays a scroll. */
const ANGLE = 1.2;
/** Release past this share of the width commits to the neighbour... */
const COMMIT_SHARE = 0.3;
/** ...and so does a flick faster than this (px/ms) in the same direction. */
const FLICK = 0.35;
/** How far the page follows the finger when there is no tab on that side. */
const RUBBER = 0.25;
const SETTLE_MS = 240;
/** In a Safari tab the screen edges belong to the browser's own back and forward swipes. */
const BROWSER_EDGE = 24;

/**
 * Swiping sideways on a tab root (Home, Messages, Search, Friends, Menu) moves to the next or
 * previous tab, with the neighbour sliding in under the finger, as in native tab apps.
 *
 * - **The neighbours are already there.** Shortly after a tab settles, both neighbours are
 *   mounted off-screen (hidden and inert) and their routes are prefetched, so their data is
 *   loaded and the first frame of a swipe already shows them. Releasing finishes the slide,
 *   then navigates; the real page replaces the preview with the same cached data.
 * - **Who owns a sideways swipe.** A swipe that starts inside anything that scrolls sideways
 *   (the widget carousel, the friends row, a code block), a form control, a chart or a
 *   fixed layer (a modal, the editing toolbar) belongs to that element for the whole
 *   gesture, even at its end. This is how iOS nests scroll views, and it means the tab can
 *   never change while someone is flicking through widgets.
 * - **Direction is decided once**, after `SLOP` pixels: a vertical start stays a scroll for the
 *   whole gesture, and a sideways one never scrolls the page.
 * - A gesture already claimed (`defaultPrevented`: pull-to-refresh, a widget being dragged) is
 *   never also a swipe.
 * - **Touch screens only.** A mouse or trackpad uses the tabs.
 *
 * As with pull-to-refresh, `touchmove` is registered non-passive **at mount**. A browser that
 * finds no cancellable listener at `touchstart` hands the gesture to the compositor, and the
 * `preventDefault` that stops the page scrolling during a swipe is then ignored.
 */
export function TabPager({
  prev,
  next,
  onSwipeStart,
  children,
}: {
  prev?: PagerTab;
  next?: PagerTab;
  onSwipeStart?: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const track = useRef<HTMLDivElement>(null);
  const prevPanel = useRef<HTMLDivElement>(null);
  const nextPanel = useRef<HTMLDivElement>(null);
  const [touch, setTouch] = useState(false);
  const [preload, setPreload] = useState(false);
  const tabs = useRef({ prev, next, onSwipeStart });
  tabs.current = { prev, next, onSwipeStart };

  useEffect(() => {
    setTouch(window.matchMedia?.('(pointer: coarse)').matches === true);
  }, []);

  // Preload after the current tab has had its turn, so it never waits on its neighbours.
  useEffect(() => {
    if (!touch) return;
    if (prev) router.prefetch(prev.href);
    if (next) router.prefetch(next.href);
    const idle =
      window.requestIdleCallback ??
      ((run: () => void) => window.setTimeout(run, 400));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => setPreload(true), { timeout: 1500 });
    return () => cancel(handle);
  }, [touch, prev?.href, next?.href, router]);

  useEffect(() => {
    if (!touch) return;
    const g = {
      tracking: false,
      axis: null as 'x' | 'y' | null,
      startX: 0,
      startY: 0,
      offset: 0,
      width: 0,
      lastX: 0,
      lastT: 0,
      velocity: 0,
      settling: false,
    };
    const reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    const layers = () =>
      [
        [track.current, 0],
        [prevPanel.current, -1],
        [nextPanel.current, 1],
      ] as const;

    const place = (offset: number, ms = 0) => {
      for (const [el, side] of layers()) {
        if (!el) continue;
        el.style.transition = ms
          ? `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
          : '';
        el.style.transform = `translate3d(${offset + side * g.width}px, 0, 0)`;
      }
    };

    const showPanels = (visible: boolean) => {
      for (const el of [prevPanel.current, nextPanel.current]) {
        if (el) el.style.visibility = visible ? 'visible' : 'hidden';
      }
    };

    /** Back to rest: no transform at all, because a transformed ancestor breaks `position: fixed`. */
    const rest = () => {
      for (const [el] of layers()) {
        if (!el) continue;
        el.style.transition = '';
        el.style.transform = '';
      }
      showPanels(false);
      g.settling = false;
    };

    const begin = () => {
      g.width = window.innerWidth;
      tabs.current.onSwipeStart?.();
      const header = document.querySelector('.portal-header');
      const top = header ? header.getBoundingClientRect().height : 0;
      for (const el of [prevPanel.current, nextPanel.current]) {
        const inner = el?.firstElementChild as HTMLElement | null;
        if (inner) inner.style.paddingTop = `${top}px`;
      }
      showPanels(true);
    };

    const onTouchStart = (event: TouchEvent) => {
      g.tracking = false;
      g.axis = null;
      if (g.settling || event.touches.length !== 1 || !track.current) return;
      const target = event.target;
      // The page itself, or the empty space under a short page (the shell and body around it).
      // The header, the tabs and anything portalled elsewhere are siblings, so they never count.
      if (
        !(target instanceof Node) ||
        !(track.current.contains(target) || target.contains(track.current))
      )
        return;
      if (ownsSideways(target, track.current)) return;
      const first = event.touches[0];
      if (
        !isStandalone() &&
        (first.clientX < BROWSER_EDGE ||
          first.clientX > window.innerWidth - BROWSER_EDGE)
      )
        return;
      g.tracking = true;
      g.startX = g.lastX = first.clientX;
      g.startY = first.clientY;
      g.lastT = event.timeStamp;
      g.velocity = 0;
      g.offset = 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!g.tracking) return;
      const point = event.touches[0];
      if (event.touches.length !== 1 || !point) return cancel();
      const dx = point.clientX - g.startX;
      const dy = point.clientY - g.startY;

      if (!g.axis) {
        if (event.defaultPrevented) return cancel();
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
          // Still undecided: keep a sideways-leaning start from turning into a page scroll.
          if (Math.abs(dx) > Math.abs(dy) && event.cancelable)
            event.preventDefault();
          return;
        }
        if (Math.abs(dx) > Math.abs(dy) * ANGLE) {
          g.axis = 'x';
          begin();
        } else {
          g.axis = 'y';
          g.tracking = false;
          return;
        }
      }

      if (event.cancelable) event.preventDefault();
      const travel = dx - Math.sign(dx) * SLOP;
      const neighbour = travel < 0 ? tabs.current.next : tabs.current.prev;
      g.offset = neighbour ? clamp(travel, g.width) : travel * RUBBER;
      place(g.offset);

      const dt = event.timeStamp - g.lastT;
      if (dt > 0)
        g.velocity = 0.8 * ((point.clientX - g.lastX) / dt) + 0.2 * g.velocity;
      g.lastX = point.clientX;
      g.lastT = event.timeStamp;
    };

    const onTouchEnd = () => {
      if (!g.tracking) return;
      g.tracking = false;
      if (g.axis !== 'x') return;
      const direction = g.offset < 0 ? 1 : -1;
      const target = direction === 1 ? tabs.current.next : tabs.current.prev;
      const far = Math.abs(g.offset) > g.width * COMMIT_SHARE;
      const flick =
        Math.abs(g.velocity) > FLICK && Math.sign(g.velocity) === -direction;
      const ms = reduced ? 0 : SETTLE_MS;
      g.settling = true;
      if (target && (far || flick)) {
        place(-direction * g.width, ms);
        // The preview stays in place until the new page replaces this whole shell.
        window.setTimeout(() => router.push(target.href), ms);
        return;
      }
      place(0, ms);
      window.setTimeout(rest, ms);
    };

    const cancel = () => {
      const moved = g.axis === 'x';
      g.tracking = false;
      g.axis = null;
      if (moved) {
        g.settling = true;
        place(0, SETTLE_MS);
        window.setTimeout(rest, SETTLE_MS);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', cancel);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', cancel);
    };
  }, [touch, router]);

  return (
    <>
      <div ref={track}>{children}</div>
      {touch &&
        preload &&
        createPortal(
          <>
            {prev && <Preview ref={prevPanel} tab={prev} />}
            {next && <Preview ref={nextPanel} tab={next} />}
          </>,
          document.body,
        )}
    </>
  );
}

function Preview({
  tab,
  ref,
}: {
  tab: PagerTab;
  ref: React.Ref<HTMLDivElement>;
}) {
  const { Content } = tab;
  return (
    <div
      ref={ref}
      aria-hidden
      inert
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden bg-surface"
      style={{ visibility: 'hidden' }}
    >
      <div className={tab.mainClass}>
        <Content />
      </div>
    </div>
  );
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

const OWNS_SWIPE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-no-tab-swipe], .recharts-wrapper';

/** True when the touch starts inside something that handles sideways movement itself. */
function ownsSideways(start: Node, root: Element): boolean {
  let node: Element | null =
    start instanceof Element ? start : start.parentElement;
  while (node && node !== root) {
    if (node.matches(OWNS_SWIPE)) return true;
    const style = getComputedStyle(node);
    if (style.position === 'fixed') return true;
    if (
      node.scrollWidth > node.clientWidth + 1 &&
      (style.overflowX === 'auto' || style.overflowX === 'scroll')
    )
      return true;
    node = node.parentElement;
  }
  return false;
}
