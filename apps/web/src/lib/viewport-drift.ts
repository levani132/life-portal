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

/**
 * How far a bottom-pinned bar must move down (px) to sit at the bottom of what is on screen.
 *
 * Never up. The drift this corrects only ever leaves the bar too high. A screen that looks
 * shorter than the layout is the keyboard, or iOS still reporting the keyboard's size just after
 * the app is reopened with no field focused; lifting the bar for that left it stranded in the
 * middle of the screen.
 */
export function bottomShift(viewport: { offsetTop: number; height: number }, layoutHeight: number, editing: boolean): number {
  if (editing) return 0;
  const shift = Math.round(viewport.offsetTop + viewport.height - layoutHeight);
  // Sub-pixel differences are rounding, not drift.
  return shift < 2 ? 0 : shift;
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
    const apply = () => {
      // A pinch-zoomed page (a desktop trackpad) is panned on purpose: that is not drift.
      const still = isEditing() || Math.abs(viewport.scale - 1) > 0.01;
      // `innerHeight`, not the document's height: it follows Safari's collapsing toolbars exactly
      // as the visual viewport does, so they only disagree when the screen has really drifted.
      root.style.setProperty('--vv-bottom-shift', `${bottomShift(viewport, window.innerHeight, still)}px`);
      root.style.setProperty('--vv-top-shift', `${topShift(viewport, still)}px`);
    };
    // Now, again once the keyboard's own animation has finished, and twice more: after the app
    // is reopened iOS can take a second or two to report the real size, and sends no event when
    // it does.
    let timers: ReturnType<typeof setTimeout>[] = [];
    const settle = () => {
      apply();
      timers.forEach(clearTimeout);
      timers = [400, 1200, 2500].map((delay) => setTimeout(apply, delay));
    };
    settle();
    viewport.addEventListener('resize', settle);
    viewport.addEventListener('scroll', settle);
    window.addEventListener('focusin', settle);
    window.addEventListener('focusout', settle);
    window.addEventListener('pageshow', settle);
    window.addEventListener('focus', settle);
    window.addEventListener('resize', settle);
    document.addEventListener('visibilitychange', settle);
    // The first touch after coming back measures again, so a wrong value never outlives a tap.
    window.addEventListener('touchstart', apply, { passive: true });
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('focus', settle);
      window.removeEventListener('resize', settle);
      window.removeEventListener('touchstart', apply);
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
