'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Keeps what the reader is looking at still while a list changes size above or around it
 * (issue #24). Browsers' own scroll anchoring (`overflow-anchor`) is not in Safari at all, and in
 * Chrome it may anchor to a node inside a card that is collapsing, so the workout list turns it
 * off and does this instead, the same everywhere:
 *
 * - An **anchor** is remembered: the card the person last touched while it is on screen, else the
 *   first card whose bottom is below the top of the viewport. Cards carry `data-scroll-anchor`.
 * - After every React commit, and whenever the container changes size (a CSS transition, the rest
 *   timer appearing), the window is scrolled by however far the anchor moved, before paint.
 * - The person's own scrolling just re-picks the anchor; it is never undone.
 * - The container never gets shorter than the current scroll needs (a **floor**), so collapsing
 *   something near the bottom of the page cannot pull the page down by clamping the scroll. The
 *   floor follows the reader back up as they scroll.
 *
 * The maths is pure (below); only `useScrollAnchor` touches the DOM.
 */

export interface AnchorCandidate {
  top: number;
  bottom: number;
}

/** The first candidate still visible below `viewportTop`, by index; -1 when none. */
export function pickAnchor(candidates: readonly AnchorCandidate[], viewportTop: number, viewportBottom: number): number {
  return candidates.findIndex((rect) => rect.bottom > viewportTop && rect.top < viewportBottom);
}

/** Whether a touched card may stay the anchor: it is at least partly on screen. */
export function stillVisible(rect: AnchorCandidate, viewportTop: number, viewportBottom: number): boolean {
  return rect.bottom > viewportTop && rect.top < viewportBottom;
}

/** How far to scroll so the anchor is back where it was. Sub-pixel noise is ignored. */
export function correction(before: number, after: number): number {
  const delta = after - before;
  return Math.abs(delta) < 1 ? 0 : delta;
}

/**
 * The least height the container may have so the page stays as tall as the current scroll needs:
 * `scrollY + viewport` must still fit in `containerTop + height + below`.
 */
export function floorHeight(scrollY: number, viewportHeight: number, containerTop: number, below: number): number {
  return Math.max(0, Math.ceil(scrollY + viewportHeight - containerTop - below));
}

/** How much taller the page must get for a scroll of `delta` to fit; 0 when it already does. */
export function shortfall(scrollY: number, delta: number, viewportHeight: number, pageHeight: number): number {
  return Math.max(0, scrollY + delta + viewportHeight - pageHeight);
}

interface Anchor {
  element: HTMLElement;
  top: number;
  /** The scroll position when it was measured: if it changed, the person scrolled. */
  scrollY: number;
}

export function useScrollAnchor(container: RefObject<HTMLElement | null>): void {
  const anchor = useRef<Anchor | null>(null);
  const touched = useRef<HTMLElement | null>(null);

  /**
   * Re-picks the anchor and sets the floor for the current scroll. The floor is set *before*
   * anything shrinks, because by the time a layout effect or resize callback runs the browser
   * may already have clamped the scroll.
   */
  const remember = () => {
    const root = container.current;
    if (!root || typeof window === 'undefined') return;
    const height = window.innerHeight;
    const pinned = touched.current;
    let element: HTMLElement | undefined;
    if (pinned?.isConnected && root.contains(pinned) && stillVisible(pinned.getBoundingClientRect(), 0, height)) element = pinned;
    if (!element) {
      const cards = [...root.querySelectorAll<HTMLElement>('[data-scroll-anchor]')];
      const index = pickAnchor(cards.map((card) => card.getBoundingClientRect()), 0, height);
      element = index >= 0 ? cards[index] : undefined;
    }
    anchor.current = element ? { element, top: element.getBoundingClientRect().top, scrollY: window.scrollY } : null;

    // What lies below the container (page padding, the nav's room) counts towards the height.
    // Never cleared first: that alone could shrink the page and clamp the scroll. A floor below
    // the natural height changes nothing, so it is simply replaced.
    const box = root.getBoundingClientRect();
    const top = box.top + window.scrollY;
    const below = Math.max(0, document.documentElement.scrollHeight - top - box.height);
    const floor = floorHeight(window.scrollY, height, top, below);
    const next = floor > 0 ? `${floor}px` : '';
    if (root.style.minHeight !== next) root.style.minHeight = next;
  };

  const correct = () => {
    const current = anchor.current;
    if (current?.element.isConnected && Math.abs(window.scrollY - current.scrollY) < 1) {
      const delta = correction(current.top, current.element.getBoundingClientRect().top);
      if (delta) {
        // Scrolling down to follow the anchor may need room the page no longer has (content above
        // grew while content below shrank, at the very bottom). Make that room first.
        const root = container.current;
        const short = shortfall(window.scrollY, delta, window.innerHeight, document.documentElement.scrollHeight);
        if (root && short > 0) root.style.minHeight = `${Math.ceil(root.getBoundingClientRect().height + short)}px`;
        window.scrollBy(0, delta);
      }
    }
    remember();
  };

  // After every commit of the owner (this runs before paint).
  useLayoutEffect(correct);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(remember);
    };
    // The card under the finger becomes the anchor, so acting on it keeps it still.
    const onPointer = (event: Event) => {
      touched.current = (event.target as Element | null)?.closest<HTMLElement>('[data-scroll-anchor]') ?? null;
      remember();
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => correct());
    resize?.observe(root);
    window.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
    remember();
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener('scroll', onScroll);
      root.removeEventListener('pointerdown', onPointer, { capture: true });
      root.style.minHeight = '';
    };
  }, [container]);
}
