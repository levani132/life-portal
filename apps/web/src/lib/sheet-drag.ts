'use client';

import { useEffect, useRef } from 'react';

/** How far down (px) a sheet must be pulled, or how fast (px/ms), for letting go to close it. */
const CLOSE_DISTANCE = 90;
const CLOSE_SPEED = 0.6;

/**
 * A bottom sheet that owns the touches on it: the page behind does not scroll while it is open,
 * and pulling the sheet down closes it (let go early and it springs back).
 *
 * `overlay` is the full-screen layer, `sheet` the panel inside it. A sideways gesture is left
 * alone, so rows that scroll sideways (people, apps) keep working. The `touchmove` listener is
 * not passive and is registered when the sheet mounts: a browser that finds no cancellable
 * listener when the touch starts hands the gesture to scrolling (the same rule as the tab swipe
 * and pull to refresh, which also ignore a gesture once it is `defaultPrevented`).
 */
export function useSheetDrag(onClose: () => void) {
  const overlay = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const layer = overlay.current;
    const panel = sheet.current;
    if (!layer || !panel) return;

    // A mouse wheel or trackpad: the page under the sheet stays put.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let speed = 0;
    let direction: 'x' | 'y' | null = null;
    let onPanel = false;

    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = lastY = touch.clientY;
      lastTime = event.timeStamp;
      speed = 0;
      direction = null;
      onPanel = panel.contains(event.target as Node);
      panel.style.transition = 'none';
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!direction) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        direction = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (direction === 'x') return;
      // Up or down: never the page's to scroll.
      event.preventDefault();
      if (!onPanel) return;
      const elapsed = event.timeStamp - lastTime;
      if (elapsed > 0) speed = (touch.clientY - lastY) / elapsed;
      lastY = touch.clientY;
      lastTime = event.timeStamp;
      // Down follows the finger; up resists, so the sheet does not lift off the screen's edge.
      panel.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`;
    };
    const end = () => {
      if (direction !== 'y' || !onPanel) return;
      const pulled = lastY - startY;
      panel.style.transition = 'transform 220ms cubic-bezier(0.3, 1, 0.4, 1)';
      if (pulled > CLOSE_DISTANCE || (pulled > 20 && speed > CLOSE_SPEED)) {
        panel.style.transform = 'translateY(100%)';
        window.setTimeout(() => close.current(), 180);
      } else {
        panel.style.transform = '';
      }
    };

    layer.addEventListener('touchstart', start, { passive: true });
    layer.addEventListener('touchmove', move, { passive: false });
    layer.addEventListener('touchend', end);
    layer.addEventListener('touchcancel', end);
    return () => {
      document.body.style.overflow = overflow;
      layer.removeEventListener('touchstart', start);
      layer.removeEventListener('touchmove', move);
      layer.removeEventListener('touchend', end);
      layer.removeEventListener('touchcancel', end);
    };
  }, []);

  return { overlay, sheet };
}
