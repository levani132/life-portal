'use client';

import { useRouter } from 'next/navigation';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { isStandalone } from '../lib/push';

/** A tab root: Home, Messages, Search, Friends or Menu. */
export interface HostTab {
  href: string;
  Content: ComponentType;
  /** The padding the tab's content sits in. */
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
 * Every tab root stays mounted for as long as the portal is open, the way native tab apps keep
 * each tab's stack. Leaving Home for Messages, or for a widget page, and coming back finds Home
 * exactly as it was: same scroll position, same open widget, same loaded posts.
 *
 * - **The open tab is in the normal page flow**, so the window scrolls it, and everything that
 *   relies on window scroll (the hiding header, pull-to-refresh, tap-the-status-bar-to-top)
 *   still works.
 * - **Every other tab is a hidden, inert, fixed layer**, fully laid out. Each tab's scroll
 *   position is remembered and restored before the first paint after switching.
 * - **The active tab mounts first; the others mount when the browser is idle**, so opening the
 *   app never waits for the tabs you are not looking at.
 *
 * Swiping sideways on a tab (touch screens only) drags the open tab and slides its neighbour in,
 * shown at the neighbour's own scroll position. Releasing finishes the slide and navigates; the
 * neighbour is already the real page, so nothing is reloaded.
 *
 * - **Who owns a sideways swipe.** A swipe that starts inside anything that scrolls sideways
 *   (the widget carousel, the friends row), a form control, a chart or a fixed layer (a modal,
 *   the editing toolbar) belongs to that element for the whole gesture, even at its end. This is
 *   how iOS nests scroll views, and it means the tab never changes while flicking through
 *   widgets.
 * - **Direction is decided once**, after `SLOP` pixels.
 * - A gesture already claimed (`defaultPrevented`: pull-to-refresh, a widget being dragged) is
 *   never also a swipe.
 * - **At rest nothing has a transform** (not even `translateX(0)`): modals are `position: fixed`
 *   inside the tab, and a transformed ancestor would pin them to it.
 * - `touchmove` is registered non-passive **at mount**, for the same reason as pull-to-refresh.
 */
export function TabHost({
  tabs,
  active,
  onSwipeStart,
}: {
  tabs: HostTab[];
  /** The open tab's href, or null while a page outside the tabs is open. */
  active: string | null;
  onSwipeStart?: () => void;
}) {
  const router = useRouter();
  const panels = useRef(new Map<string, HTMLElement>());
  const scrolls = useRef(new Map<string, number>());
  const [mountAll, setMountAll] = useState(false);
  const [touch, setTouch] = useState(false);
  const live = useRef({ tabs, active, onSwipeStart });
  live.current = { tabs, active, onSwipeStart };
  const shown = useRef<string | null>(null);

  useEffect(() => {
    setTouch(window.matchMedia?.('(pointer: coarse)').matches === true);
    const idle =
      window.requestIdleCallback ??
      ((run: () => void) => window.setTimeout(run, 400));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => setMountAll(true), { timeout: 1500 });
    return () => cancel(handle);
  }, []);

  useEffect(() => {
    for (const tab of tabs) router.prefetch(tab.href);
  }, [tabs, router]);

  // Remember where the open tab is scrolled to. Scroll events alone are not enough: a browser
  // may not deliver the last one before a switch (a background tab delivers none), and once the
  // switch commits the old scroll position is gone. So it is also recorded on every touch and
  // click (which is what starts any navigation) and on the back button.
  useEffect(() => {
    const remember = () => {
      if (shown.current) scrolls.current.set(shown.current, window.scrollY);
    };
    const events = ['scroll', 'touchstart', 'click', 'popstate'] as const;
    for (const name of events)
      window.addEventListener(name, remember, { passive: true, capture: true });
    return () => {
      for (const name of events)
        window.removeEventListener(name, remember, { capture: true });
    };
  }, []);

  // Switching tabs (a tap, a swipe, the back button): clear any swipe leftovers and restore the
  // new tab's scroll before the browser paints, so the switch is a single clean frame.
  useLayoutEffect(() => {
    for (const el of panels.current.values()) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.visibility = '';
      const inner = el.firstElementChild as HTMLElement | null;
      if (inner) inner.style.transform = '';
    }
    shown.current = active;
    window.scrollTo(0, active ? (scrolls.current.get(active) ?? 0) : 0);
  }, [active]);

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
      prev: null as HostTab | null,
      next: null as HostTab | null,
    };
    const reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

    const layers = () => {
      const { active: href } = live.current;
      return [
        [href ? panels.current.get(href) : undefined, 0],
        [g.prev ? panels.current.get(g.prev.href) : undefined, -1],
        [g.next ? panels.current.get(g.next.href) : undefined, 1],
      ] as const;
    };

    const place = (offset: number, ms = 0) => {
      for (const [el, side] of layers()) {
        if (!el) continue;
        el.style.transition = ms
          ? `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
          : '';
        el.style.transform = `translate3d(${offset + side * g.width}px, 0, 0)`;
      }
    };

    const rest = () => {
      for (const [el, side] of layers()) {
        if (!el) continue;
        el.style.transition = '';
        el.style.transform = '';
        if (side !== 0) el.style.visibility = '';
      }
      g.settling = false;
    };

    /** Shows each neighbour where its own content was scrolled to, under the header. */
    const begin = () => {
      g.width = window.innerWidth;
      live.current.onSwipeStart?.();
      const header = document.querySelector('.portal-header');
      const top = header ? header.getBoundingClientRect().height : 0;
      for (const [el, side] of layers()) {
        if (!el || side === 0) continue;
        const href = side < 0 ? g.prev?.href : g.next?.href;
        const inner = el.firstElementChild as HTMLElement | null;
        if (inner && href)
          inner.style.transform = `translate3d(0, ${top - (scrolls.current.get(href) ?? 0)}px, 0)`;
        el.style.transform = `translate3d(${side * g.width}px, 0, 0)`;
        el.style.visibility = 'visible';
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      g.tracking = false;
      g.axis = null;
      const { tabs: list, active: href } = live.current;
      if (g.settling || !href || event.touches.length !== 1) return;
      const panel = panels.current.get(href);
      const target = event.target;
      // The tab itself, or the empty space under a short tab (the shell and body around it).
      // The header, the tabs bar and the hidden tabs never count.
      if (
        !panel ||
        !(target instanceof Node) ||
        !(panel.contains(target) || target.contains(panel))
      )
        return;
      if (ownsSideways(target, panel)) return;
      const first = event.touches[0];
      if (
        !isStandalone() &&
        (first.clientX < BROWSER_EDGE ||
          first.clientX > window.innerWidth - BROWSER_EDGE)
      )
        return;
      const index = list.findIndex((tab) => tab.href === href);
      g.prev = list[index - 1] ?? null;
      g.next = list[index + 1] ?? null;
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
      const neighbour = travel < 0 ? g.next : g.prev;
      g.offset = neighbour
        ? Math.max(-g.width, Math.min(g.width, travel))
        : travel * RUBBER;
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
      const target = direction === 1 ? g.next : g.prev;
      const far = Math.abs(g.offset) > g.width * COMMIT_SHARE;
      const flick =
        Math.abs(g.velocity) > FLICK && Math.sign(g.velocity) === -direction;
      const ms = reduced ? 0 : SETTLE_MS;
      g.settling = true;
      if (target && (far || flick)) {
        place(-direction * g.width, ms);
        // The neighbour stays in place until the route changes; the layout effect above then
        // makes it the open tab in the same frame.
        window.setTimeout(() => {
          g.settling = false;
          router.push(target.href, { scroll: false });
        }, ms);
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
      {tabs.map((tab) => {
        const open = tab.href === active;
        if (!open && !mountAll) return null;
        const { Content } = tab;
        return (
          <section
            key={tab.href}
            ref={(el) => {
              if (el) panels.current.set(tab.href, el);
              else panels.current.delete(tab.href);
            }}
            aria-hidden={open ? undefined : true}
            inert={!open}
            className={
              open
                ? undefined
                : 'pointer-events-none invisible fixed inset-0 z-30 overflow-hidden bg-surface'
            }
          >
            <div className={tab.mainClass}>
              <Content />
            </div>
          </section>
        );
      })}
    </>
  );
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
