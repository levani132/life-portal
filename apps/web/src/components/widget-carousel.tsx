'use client';

import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_WIDGET_SIZE, type WidgetCard, type WidgetSize } from '@life-portal/shared-types';
import { SortableGrid, type SortableState } from './sortable-grid';

interface Props {
  cards: WidgetCard[];
  editing: boolean;
  onEditingChange: (value: boolean) => void;
  onOrderChange: (ids: string[]) => void;
  onCommit: (ids: string[]) => void;
  children: (card: WidgetCard, state: SortableState) => ReactNode;
}

/**
 * Where a card snaps: the first to the left edge, the last to the right, the rest centred, so a
 * centred card shows a slice of both neighbours. A half-width card snaps to the left instead:
 * centred, it would show two quarter slices rather than the whole card beside it.
 */
export function snapAlign(index: number, count: number, size: WidgetSize = DEFAULT_WIDGET_SIZE): 'start' | 'center' | 'end' {
  if (index === 0) return 'start';
  if (index === count - 1) return 'end';
  return size === 'half' ? 'start' : 'center';
}

/**
 * A card's width, as a share of the strip (`cqw`: the strip is a size container). The 8px gap
 * is split between a card and what shows beside it, so two halves, or three quarters and a
 * quarter of the next card, fill the strip exactly. A lone card always takes all of it.
 */
export function slotWidth(size: WidgetSize, count: number): string {
  if (count === 1 || size === 'full') return '100cqw';
  return size === 'half' ? 'calc(50cqw - var(--widget-gap) / 2)' : 'calc(75cqw - var(--widget-gap) / 2)';
}

/**
 * Home's widget strip: a plain pager.
 *
 * Every widget is one card of the width its owner chose (half, three quarters or all of the
 * strip) that always shows its full content; the browser's own
 * scrolling and snapping do all the moving, and the next card shows as a slice of itself. There
 * is deliberately no scroll-driven layout here: an earlier version resized the cards under the
 * finger and swapped their content once the strip came to rest, and that wait after every swipe
 * was the thing people noticed. See docs/DECISIONS.md.
 *
 * The strip's two edges are "walls": the strip clips with rounded corners, and where a card is
 * cut by an edge its outline is closed there by a rounded line, so the card
 * reads as sliding behind glass. A wall shows only while a card is
 * actually crossing it, never over the gap between cards or at either end of the strip. That is
 * the one thing scrolling drives, and it is two attributes written straight to the DOM (no React
 * state, no layout change).
 */

/** Which edges of a `width`-wide view a card at `left`..`left + size` is cut by. */
export function cutEdges(cards: readonly { left: number; size: number }[], width: number): { left: boolean; right: boolean } {
  const crosses = (edge: number) => cards.some((card) => card.left < edge - 0.5 && card.left + card.size > edge + 0.5);
  return { left: crosses(0), right: crosses(width) };
}

export function WidgetCarousel({
  cards,
  editing,
  onEditingChange,
  onOrderChange,
  onCommit,
  children,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const walls = useRef<HTMLDivElement>(null);
  // Home opens on Food wherever the person has put it (spec 008); after that the strip stays
  // where it was left.
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      cards.findIndex((card) => card.key === 'nutrition'),
    ),
  );
  const frame = useRef(0);
  const count = cards.length;

  const slots = () =>
    Array.from(
      viewport.current?.querySelectorAll<HTMLElement>('[role="listitem"]') ??
        [],
    );
  /** The scroll position that puts a card on its snap point. */
  const restFor = (el: HTMLElement, index: number) => {
    const view = viewport.current;
    if (!view) return 0;
    const align = snapAlign(index, count, cards[index]?.size);
    const spare = view.clientWidth - el.offsetWidth;
    return el.offsetLeft - (align === 'start' ? 0 : align === 'end' ? spare : spare / 2);
  };
  const go = (index: number, immediate = false) => {
    const el = slots()[index];
    if (!el) return;
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    viewport.current?.scrollTo({
      left: restFor(el, index),
      behavior: immediate || reduced ? 'instant' : 'smooth',
    });
  };

  /** Shows a wall exactly where a card is cut by that edge. */
  const markWalls = () => {
    const view = viewport.current;
    if (!view || !walls.current) return;
    const cut = cutEdges(
      slots().map((el) => ({ left: el.offsetLeft - view.scrollLeft, size: el.offsetWidth })),
      view.clientWidth,
    );
    walls.current.toggleAttribute('data-cut-left', cut.left);
    walls.current.toggleAttribute('data-cut-right', cut.right);
  };

  // The dot is already right from the first render; this only moves the strip under it.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current || !count) return;
    opened.current = true;
    if (active > 0) go(active, true);
  });
  // After every render (cards added, reordered, resized) and when the strip itself resizes.
  useLayoutEffect(markWalls);
  useEffect(() => {
    const view = viewport.current;
    if (!view || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(markWalls);
    observer.observe(view);
    return () => observer.disconnect();
    // Once: `markWalls` reads refs only.
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  if (!count) return null;
  const current = Math.min(active, count - 1);
  // On phones the strip runs almost edge to edge (4px gutters), like the feed below it.
  return (
    <section
      aria-label="Home widgets"
      aria-roledescription="carousel"
      className="-mx-3 sm:mx-0"
    >
      <div ref={walls} className="widget-carousel-walls relative">
      <div
        ref={viewport}
        className="widget-carousel-viewport relative overflow-x-auto"
        style={{ scrollSnapType: editing ? 'none' : 'x mandatory' }}
        tabIndex={editing ? -1 : 0}
        aria-label={`${cards[current]?.title} selected. Scroll or use left and right arrow keys to browse widgets.`}
        onScroll={() => {
          markWalls();
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => {
            const view = viewport.current;
            if (!view) return;
            // The card resting nearest its own snap point is the one the dots name.
            let nearest = 0;
            let best = Infinity;
            slots().forEach((el, index) => {
              const distance = Math.abs(restFor(el, index) - view.scrollLeft);
              if (distance < best) {
                best = distance;
                nearest = index;
              }
            });
            setActive(nearest);
          });
        }}
        onKeyDown={(event) => {
          if (editing || event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            go(current + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}
      >
        <SortableGrid
          items={cards}
          getId={(card) => card.id}
          getLabel={(card) => card.title}
          editing={editing}
          onEditingChange={onEditingChange}
          onOrderChange={onOrderChange}
          onCommit={onCommit}
          className="flex h-[184px] w-max items-stretch gap-2 sm:gap-3"
          // Each card takes the width its owner chose for it (`card.size`).
          getItemStyle={(card, index) => ({
            flexShrink: 0,
            width: slotWidth(card.size ?? DEFAULT_WIDGET_SIZE, count),
            scrollSnapAlign: snapAlign(index, count, card.size),
          })}
        >
          {(card, state) => children(card, state)}
        </SortableGrid>
      </div>
      <span aria-hidden className="widget-wall widget-wall-left" />
      <span aria-hidden className="widget-wall widget-wall-right" />
      </div>
      {count > 1 && (
        <div className="flex h-7 items-center justify-center">
          {cards.map((card, index) => (
            <button
              key={card.id}
              type="button"
              className="flex h-7 w-5 items-center justify-center"
              aria-label={`Show ${card.title}`}
              aria-current={index === current || undefined}
              disabled={editing}
              onClick={() => go(index)}
            >
              <span
                aria-hidden
                className={clsx(
                  'h-1.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none',
                  index === current ? 'w-4 bg-ink' : 'w-1.5 bg-border',
                )}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
