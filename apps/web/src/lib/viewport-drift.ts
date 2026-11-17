'use client';

import { useEffect } from 'react';

/**
 * iOS can leave the visual viewport (what is on screen) shifted inside the layout viewport after
 * the keyboard has been open, most often in the installed app. `position: fixed` is laid out
 * against the layout viewport, so a bar pinned to the bottom is then drawn that far up the screen
 * (and the header that far off the top) until something makes iOS line the two up again.
 *
 * This measures the drift and publishes it on the root as `--vv-bottom-shift` and
 * `--vv-top-shift`; the tab bar and the header move themselves by it, so they sit at the real
 * edges of the screen whatever iOS is doing. While a field has focus the keyboard is up and the
 * difference is the keyboard itself: then nothing is shifted, so the bar does not jump above it.
 */

/** How far a bottom-pinned bar must move down (px) to sit at the bottom of what is on screen. */
export function bottomShift(viewport: { offsetTop: number; height: number }, layoutHeight: number, editing: boolean): number {
  if (editing) return 0;
  const shift = Math.round(viewport.offsetTop + viewport.height - layoutHeight);
  // Sub-pixel differences are rounding, not drift.
  return Math.abs(shift) < 2 ? 0 : shift;
}

/** How far a top-pinned header must move down (px) to sit at the top of what is on screen. */
export function topShift(viewport: { offsetTop: number }, editing: boolean): number {
  if (editing) return 0;
  const shift = Math.round(viewport.offsetTop);
  return Math.abs(shift) < 2 ? 0 : shift;
}

const isEditing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** Keeps `--vv-bottom-shift` / `--vv-top-shift` on the root element up to date. Mount once. */
export function useViewportDrift(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      // A pinch-zoomed page (a desktop trackpad) is panned on purpose: that is not drift.
      const still = isEditing() || Math.abs(viewport.scale - 1) > 0.01;
      // `innerHeight`, not the document's height: it follows Safari's collapsing toolbars exactly
      // as the visual viewport does, so they only disagree when the screen has really drifted.
      root.style.setProperty('--vv-bottom-shift', `${bottomShift(viewport, window.innerHeight, still)}px`);
      root.style.setProperty('--vv-top-shift', `${topShift(viewport, still)}px`);
    };
    // Now, and again once the keyboard's own animation has finished.
    const settle = () => {
      apply();
      clearTimeout(timer);
      timer = setTimeout(apply, 400);
    };
    settle();
    viewport.addEventListener('resize', settle);
    viewport.addEventListener('scroll', settle);
    window.addEventListener('focusin', settle);
    window.addEventListener('focusout', settle);
    window.addEventListener('pageshow', settle);
    document.addEventListener('visibilitychange', settle);
    return () => {
      clearTimeout(timer);
      viewport.removeEventListener('resize', settle);
      viewport.removeEventListener('scroll', settle);
      window.removeEventListener('focusin', settle);
      window.removeEventListener('focusout', settle);
      window.removeEventListener('pageshow', settle);
      document.removeEventListener('visibilitychange', settle);
      root.style.removeProperty('--vv-bottom-shift');
      root.style.removeProperty('--vv-top-shift');
    };
  }, []);
}
