'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Issue #32: on opening the open workout, or coming back to its tab, the page glides to the first
 * exercise that still has sets to do, placed just under what sticks at the top (the app header
 * and the rest timer). Once per entry: never after a set is ticked, never while the person is
 * already scrolling, and not at all when nothing is left to do.
 *
 * The maths is pure; only the hook touches the DOM.
 */
export interface EntryGeometry {
  /** The card's top relative to the viewport. */
  cardTop: number;
  scrollY: number;
  /** What covers the top of the viewport above the card once the scroll is done. */
  covered: number;
  /** Room left between what sticks and the card. */
  gap?: number;
}

/** Where to scroll to, or `null` when the card is already where it would land. */
export function entryScrollTarget({ cardTop, scrollY, covered, gap = 8 }: EntryGeometry): number | null {
  const target = Math.max(0, Math.round(scrollY + cardTop - covered - gap));
  return Math.abs(target - scrollY) < 4 ? null : target;
}

const isInert = (el: HTMLElement | null) => Boolean(el?.hasAttribute('inert'));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

function covered(): number {
  // The app header never hides on Training; the rest timer sticks under it.
  const header = document.querySelector<HTMLElement>('header.portal-header');
  const timer = document.querySelector<HTMLElement>('[data-testid="rest-timer"]');
  return (header?.getBoundingClientRect().height ?? 0) + (timer?.getBoundingClientRect().height ?? 0);
}

/**
 * `list` is the workout's card list; the target is the card marked `aria-current="step"` (none
 * when every exercise is done, and then nothing moves). `enabled` is false for a finished workout.
 */
export function useScrollToCurrentOnEntry(list: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const root = list.current;
    if (!enabled || !root) return;
    // The tab this workout lives in: hidden tabs are `inert`, and becoming visible is an entry.
    const panel = root.closest('section');
    let frame = 0;
    let userMoved = false;
    const onUser = () => {
      userMoved = true;
    };
    const events = ['wheel', 'touchstart', 'keydown'] as const;
    const go = () => {
      cancelAnimationFrame(frame);
      userMoved = false;
      for (const name of events) window.addEventListener(name, onUser, { passive: true, once: true });
      // Two frames: after React has painted and after the tab host has restored its scroll.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          for (const name of events) window.removeEventListener(name, onUser);
          if (userMoved || !root.isConnected || isInert(panel)) return;
          const card = root.querySelector<HTMLElement>('[aria-current="step"]');
          if (!card) return;
          const top = entryScrollTarget({ cardTop: card.getBoundingClientRect().top, scrollY: window.scrollY, covered: covered() });
          if (top !== null) window.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
        });
      });
    };
    if (!isInert(panel)) go();
    const observer =
      panel && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            if (!isInert(panel)) go();
          })
        : null;
    observer?.observe(panel as Node, { attributes: true, attributeFilter: ['inert'] });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      for (const name of events) window.removeEventListener(name, onUser);
    };
    // Runs per entry: mounting this workout (or opening a different one), or its tab returning.
    // A new current exercise after a tick is deliberately not a reason to scroll.
  }, [enabled, list]);
}
