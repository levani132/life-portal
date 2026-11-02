'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WidgetCard } from '@life-portal/shared-types';
import { SortableGrid, type SortableState } from './sortable-grid';

interface Props {
  cards: WidgetCard[];
  editing: boolean;
  onEditingChange: (value: boolean) => void;
  onOrderChange: (ids: string[]) => void;
  onCommit: (ids: string[]) => void;
  children: (
    card: WidgetCard,
    state: SortableState,
    expanded: boolean,
    select: () => void,
  ) => ReactNode;
}

export function WidgetCarousel({
  cards,
  editing,
  onEditingChange,
  onOrderChange,
  onCommit,
  children,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const swipeClick = useRef(false);
  const mouse = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    moved: boolean;
  } | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const activeId = cards.some((card) => card.id === selectedId)
    ? selectedId
    : (cards.find((card) => card.key === 'nutrition')?.id ?? cards[0]?.id);
  const activeIndex = cards.findIndex((card) => card.id === activeId);
  const gap = width >= 640 ? 12 : 8;
  const peek = width >= 640 ? 128 : 56;
  const step = peek + gap;
  const progress = position ?? activeIndex;
  const leftGutter = Math.min(1, Math.max(0, progress)) * step;
  const rightGutter =
    Math.min(1, Math.max(0, cards.length - 1 - progress)) * step;
  const expandedWidth = Math.max(0, width - leftGutter - rightGutter);
  // Transfer the extra width continuously between neighbors, keeping total track width fixed.
  const itemWidth = (index: number) =>
    cards.length === 1
      ? width
      : peek +
        (expandedWidth - peek) * Math.max(0, 1 - Math.abs(index - progress));
  const order = cards.map((card) => card.id).join(':');
  const scrollTo = (index: number, immediate = false) => {
    viewport.current?.scrollTo({
      left: index * step,
      behavior:
        immediate ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
    });
  };
  const select = (index: number) => {
    const card = cards[index];
    if (!card) return;
    setSelectedId(card.id);
    scrollTo(index);
  };
  const navigation = useRef({ activeIndex, editing, step, cards });
  navigation.current = { activeIndex, editing, step, cards };

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!width || editing) return;
    setPosition(navigation.current.activeIndex);
    viewport.current?.scrollTo({
      left: navigation.current.activeIndex * step,
      behavior: 'instant',
    });
  }, [width, step, order, editing]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    // Horizontal wheels/trackpads scroll natively. Shift-wheel is a continuous mouse fallback.
    const wheel = (event: WheelEvent) => {
      if (navigation.current.editing || !event.shiftKey || event.deltaX) return;
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
      event.preventDefault();
      el.scrollLeft += event.deltaY * scale;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const finishDrag = () => {
    const gesture = mouse.current;
    mouse.current = null;
    setDragging(false);
    if (!gesture?.moved) return;
    const el = viewport.current;
    if (!el) return;
    if (el.hasPointerCapture?.(gesture.pointerId))
      el.releasePointerCapture(gesture.pointerId);
    const index = Math.max(
      0,
      Math.min(cards.length - 1, Math.round(el.scrollLeft / step)),
    );
    select(index);
  };

  if (!cards.length) return null;
  return (
    <section aria-label="Home widgets" aria-roledescription="carousel">
      <div
        ref={viewport}
        className={`widget-carousel-viewport overflow-x-auto ${editing ? '' : 'cursor-grab'} ${dragging ? 'cursor-grabbing select-none' : ''}`}
        style={{ scrollSnapType: editing || dragging ? 'none' : 'x mandatory' }}
        tabIndex={editing ? -1 : 0}
        aria-label={`${cards[activeIndex]?.title} selected. Scroll or use left and right arrow keys to browse widgets.`}
        onScroll={(event) => {
          if (editing || !step) return;
          const index = Math.max(
            0,
            Math.min(
              cards.length - 1,
              Math.round(event.currentTarget.scrollLeft / step),
            ),
          );
          setPosition(
            Math.max(
              0,
              Math.min(cards.length - 1, event.currentTarget.scrollLeft / step),
            ),
          );
          const card = cards[index];
          if (card) setSelectedId(card.id);
        }}
        onKeyDown={(event) => {
          if (editing || event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            select(activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}
        onPointerDown={(event) => {
          swipeClick.current = false;
          if (editing || event.pointerType !== 'mouse' || event.button !== 0)
            return;
          mouse.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const gesture = mouse.current;
          if (!gesture || gesture.pointerId !== event.pointerId || editing)
            return;
          const dx = event.clientX - gesture.x;
          if (!gesture.moved) {
            if (Math.abs(dx) < 8) return;
            if (Math.abs(dx) < Math.abs(event.clientY - gesture.y)) {
              mouse.current = null;
              return;
            }
            gesture.moved = true;
            swipeClick.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            // Disable snap synchronously so every drag movement follows the pointer.
            event.currentTarget.style.scrollSnapType = 'none';
            setDragging(true);
          }
          event.preventDefault();
          event.currentTarget.scrollLeft = gesture.left - dx;
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onClickCapture={(event) => {
          if (!swipeClick.current) return;
          swipeClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        onTouchStart={(event) => {
          swipeClick.current = false;
          const first = event.touches[0];
          touch.current =
            !editing && event.touches.length === 1 && first
              ? { x: first.clientX, y: first.clientY }
              : null;
        }}
        onTouchMove={(event) => {
          const start = touch.current;
          const current = event.touches[0];
          if (!start || !current) return;
          const dx = Math.abs(current.clientX - start.x);
          if (dx > 10 && dx > Math.abs(current.clientY - start.y))
            swipeClick.current = true;
        }}
        onTouchEnd={() => {
          touch.current = null;
        }}
        onTouchCancel={() => {
          touch.current = null;
        }}
      >
        <div
          className="relative"
          style={{
            width: width ? width + (cards.length - 1) * step : undefined,
          }}
        >
          {/* Fixed snap points stay independent of the widgets' growing/shrinking widths. */}
          {cards.map((card, index) => (
            <span
              key={card.id}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 h-px w-px"
              style={{ left: index * step, scrollSnapAlign: 'start' }}
            />
          ))}
          <SortableGrid
            items={cards}
            getId={(card) => card.id}
            getLabel={(card) => card.title}
            editing={editing}
            onEditingChange={onEditingChange}
            onOrderChange={onOrderChange}
            onCommit={onCommit}
            className="flex h-[216px] items-stretch"
            style={{ paddingLeft: leftGutter, paddingRight: rightGutter }}
            getItemStyle={(_card, index) => ({
              width: width ? itemWidth(index) : '100%',
              flexShrink: 0,
              marginRight: index < cards.length - 1 ? gap : 0,
            })}
          >
            {(card, state) =>
              children(card, state, card.id === activeId, () =>
                select(state.index),
              )
            }
          </SortableGrid>
        </div>
      </div>
      {cards.length > 1 && (
        <div className="flex h-8 items-center justify-center gap-3 text-xs text-ink-faint">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:text-ink disabled:opacity-25"
            disabled={activeIndex <= 0 || editing}
            aria-label="Previous widget"
            onClick={() => select(activeIndex - 1)}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <span aria-live="polite" aria-atomic="true">
            {cards[activeIndex]?.title} · {activeIndex + 1} / {cards.length}
          </span>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:text-ink disabled:opacity-25"
            disabled={activeIndex >= cards.length - 1 || editing}
            aria-label="Next widget"
            onClick={() => select(activeIndex + 1)}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      )}
    </section>
  );
}
