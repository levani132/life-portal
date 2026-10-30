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
  const viewport = useRef<HTMLDivElement>(null);
  const swipeClick = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const activeId = cards.some((card) => card.id === selectedId)
    ? selectedId
    : (cards.find((card) => card.key === 'nutrition')?.id ?? cards[0]?.id);
  const activeIndex = cards.findIndex((card) => card.id === activeId);
  // Neighbors remain legible previews; the focus receives the rest of the width.
  const peek = width >= 640 ? 128 : 56;
  const gap = width >= 640 ? 12 : 8;
  const neighbors =
    Number(activeIndex > 0) + Number(activeIndex < cards.length - 1);
  const expandedWidth = Math.max(0, width - neighbors * (peek + gap));
  const select = (index: number) => {
    const card = cards[index];
    if (card) setSelectedId(card.id);
  };
  const navigation = useRef({ editing, activeIndex, select });
  navigation.current = { editing, activeIndex, select };

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
    if (editing) return;
    const left = Math.max(0, activeIndex - 1) * (peek + gap);
    viewport.current?.scrollTo({
      left,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [activeIndex, peek, gap, width, editing]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let accumulated = 0;
    let last = -Infinity;
    let lastWheel = 0;
    const wheel = (event: WheelEvent) => {
      const state = navigation.current;
      const delta = event.shiftKey ? event.deltaY : event.deltaX;
      if (
        state.editing ||
        Math.abs(delta) <= Math.abs(event.shiftKey ? 0 : event.deltaY)
      )
        return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheel > 180) accumulated = 0;
      lastWheel = now;
      if (now - last < 320) return;
      accumulated += delta * (event.deltaMode === 1 ? 16 : 1);
      if (Math.abs(accumulated) < 30) return;
      state.select(state.activeIndex + Math.sign(accumulated));
      accumulated = 0;
      last = now;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  if (!cards.length) return null;
  return (
    <section aria-label="Home widgets" aria-roledescription="carousel">
      <div
        ref={viewport}
        className={`widget-carousel-viewport ${editing ? 'overflow-x-auto' : 'overflow-x-hidden'}`}
        tabIndex={editing ? -1 : 0}
        aria-label={`${cards[activeIndex]?.title} selected. Swipe or use left and right arrow keys to select a widget.`}
        onKeyDown={(event) => {
          if (editing || event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            select(activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}
        onPointerDown={() => { swipeClick.current = false; }}
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
        onTouchEnd={(event) => {
          const start = touch.current;
          touch.current = null;
          const end = event.changedTouches[0];
          if (!start || !end || navigation.current.editing) return;
          const dx = start.x - end.clientX;
          const dy = start.y - end.clientY;
          if (Math.abs(dx) > 32 && Math.abs(dx) > Math.abs(dy) * 1.3)
            select(activeIndex + Math.sign(dx));
        }}
        onTouchCancel={() => {
          touch.current = null;
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
          className="flex h-[216px] items-stretch"
          style={{ width: width ? expandedWidth + (cards.length - 1) * (peek + gap) : undefined }}
          getItemStyle={(card, index) => ({
            width: width
              ? card.id === activeId
                ? expandedWidth
                : peek
              : '100%',
            flexShrink: 0,
            marginRight: index < cards.length - 1 ? gap : 0,
            transition: 'width 240ms cubic-bezier(0.2, 0, 0, 1)',
            // Offscreen slots must not leave invisible links/buttons in the tab order.
            visibility:
              !editing && Math.abs(index - activeIndex) > 1
                ? 'hidden'
                : 'visible',
          })}
        >
          {(card, state) =>
            children(card, state, card.id === activeId, () =>
              select(state.index),
            )
          }
        </SortableGrid>
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
