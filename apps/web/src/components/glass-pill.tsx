'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

const SELECTED = '[aria-selected="true"], [aria-pressed="true"]';

/**
 * The lit pane behind the selected tab of a glass tab strip, which slides to the next tab when
 * the selection changes. Put it first inside the tabs' container (which must be `relative`); it
 * finds the selected tab by `aria-selected` / `aria-pressed` and takes its box.
 *
 * It measures after every render of its parent and when the container resizes, and writes the
 * box straight to its own style: no state, so it never causes a render. The first placement is
 * not animated; later ones are (CSS, and not under reduced motion).
 */
export function GlassPill() {
  const pill = useRef<HTMLSpanElement>(null);
  const place = () => {
    const el = pill.current;
    const selected = el?.parentElement?.querySelector<HTMLElement>(SELECTED);
    if (!el) return;
    if (!selected) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = '1';
    el.style.left = `${selected.offsetLeft}px`;
    el.style.top = `${selected.offsetTop}px`;
    el.style.width = `${selected.offsetWidth}px`;
    el.style.height = `${selected.offsetHeight}px`;
    el.style.borderRadius = getComputedStyle(selected).borderRadius;
  };
  useLayoutEffect(place);
  useEffect(() => {
    const el = pill.current;
    // Only after the first placement has painted, so the pill never slides in from the corner.
    const frame = requestAnimationFrame(() => el?.setAttribute('data-ready', ''));
    const parent = el?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(place);
    observer.observe(parent);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // Once: `place` reads the DOM only.
  }, []);
  return <span ref={pill} aria-hidden className="glass-tab-pill" />;
}
