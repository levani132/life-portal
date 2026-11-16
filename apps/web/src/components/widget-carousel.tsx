'use client';

import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { WidgetCard } from '@life-portal/shared-types';
import { SortableGrid, type SortableState } from './sortable-grid';

interface Props {
  cards: WidgetCard[];
  editing: boolean;
  onEditingChange: (value: boolean) => void;
  onOrderChange: (ids: string[]) => void;
  onCommit: (ids: string[]) => void;
  children: (card: WidgetCard, state: SortableState) => ReactNode;
}

/** Where a card snaps: the first to the left edge, the last to the right, the rest centred. */
function snapAlign(index: number, count: number): 'start' | 'center' | 'end' {
  return index === 0 ? 'start' : index === count - 1 ? 'end' : 'center';
}

/**
 * Home's widget strip: a plain pager.
 *
 * Every widget is one fixed-size card that always shows its full content; the browser's own
 * scrolling and snapping do all the moving, and the next card shows as a slice of itself. There
 * is deliberately no scroll-driven layout here: an earlier version resized the cards under the
 * finger and swapped their content once the strip came to rest, and that wait after every swipe
 * was the thing people noticed. See docs/DECISIONS.md.
 */
export function WidgetCarousel({
  cards,
  editing,
  onEditingChange,
  onOrderChange,
  onCommit,
  children,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
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
    const align = snapAlign(index, count);
    const spare = view.clientWidth - el.offsetWidth;
    return (
      el.offsetLeft -
      (align === 'start' ? 0 : align === 'end' ? spare : spare / 2)
    );
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

  // The dot is already right from the first render; this only moves the strip under it.
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current || !count) return;
    opened.current = true;
    if (active > 0) go(active, true);
  });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  if (!count) return null;
  const current = Math.min(active, count - 1);
  // On phones the strip runs almost edge to edge (2px gutters), like the feed below it.
  return (
    <section
      aria-label="Home widgets"
      aria-roledescription="carousel"
      className="-mx-3.5 sm:mx-0"
    >
      <div
        ref={viewport}
        className="widget-carousel-viewport relative overflow-x-auto"
        style={{ scrollSnapType: editing ? 'none' : 'x mandatory' }}
        tabIndex={editing ? -1 : 0}
        aria-label={`${cards[current]?.title} selected. Scroll or use left and right arrow keys to browse widgets.`}
        onScroll={() => {
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
          // Card widths come from CSS (`.widget-carousel-viewport .widget-slot`).
          getItemStyle={(_card, index) => ({
            flexShrink: 0,
            scrollSnapAlign: snapAlign(index, count),
          })}
        >
          {(card, state) => children(card, state)}
        </SortableGrid>
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
