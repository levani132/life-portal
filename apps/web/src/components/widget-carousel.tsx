'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
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

/** Moving the strip further than this off its resting widget hands the content over to compact. */
const MOVE_SLOP_PX = 6;
/** Quiet time after the last scroll event before the strip counts as at rest. */
const SETTLE_MS = 90;

/**
 * Home's focus strip: one widget at full size, its neighbours peeking in at the edges.
 *
 * Native scrolling is only the *input* here. The scroll container holds an invisible spacer
 * with one snap point per widget; the visible strip is pinned in place with `position: sticky`
 * and laid out from the scroll progress. That split is what makes the gesture follow the hand:
 * one widget's worth of scroll is exactly the distance the incoming widget's leading edge has to
 * travel, so the gap between the shrinking and the growing widget stays under the finger, and
 * the browser still supplies momentum, rubber-banding and snapping.
 *
 * The cards' content never reflows mid-gesture. The resting widget is told to go compact as soon
 * as the strip moves, and the incoming one only expands once the strip has come to rest — the
 * widget animates between its two faces, the strip only changes the frame around them.
 */
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
  const [moving, setMoving] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const restIndex = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const settleTries = useRef(0);
  const touching = useRef(false);
  const swipeClick = useRef(false);
  const mouse = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    moved: boolean;
  } | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const count = cards.length;
  const activeId = cards.some((card) => card.id === selectedId)
    ? selectedId
    : (cards.find((card) => card.key === 'nutrition')?.id ?? cards[0]?.id);
  const activeIndex = cards.findIndex((card) => card.id === activeId);
  const gap = width >= 640 ? 12 : 8;
  const peek = width >= 640 ? 128 : 56;
  const peekStep = peek + gap;
  // The distance the incoming widget's leading edge travels, from peeking at the right edge to
  // its resting place. Scrolling exactly that far per widget keeps the motion 1:1.
  const step = count > 1 ? Math.max(1, width - 2 * peek - gap) : 1;
  const restWidth = (index: number) =>
    count === 1
      ? width
      : width - (index > 0 ? peekStep : 0) - (index < count - 1 ? peekStep : 0);
  const order = cards.map((card) => card.id).join(':');

  // Every edge moves linearly between two resting layouts, so nothing outruns the finger.
  const geometry = useRef({ peek, peekStep, restWidth });
  geometry.current = { peek, peekStep, restWidth };
  const applyLayout = useCallback((p: number) => {
    const grid = stage.current?.firstElementChild as HTMLElement | null;
    if (!grid) return;
    const { peek, peekStep, restWidth } = geometry.current;
    grid.style.transform = `translate3d(${-Math.max(0, p - 1) * peekStep}px, 0, 0)`;
    Array.from(grid.children).forEach((child, index) => {
      const share = Math.max(0, 1 - Math.abs(index - p));
      (child as HTMLElement).style.width =
        `${peek + (restWidth(index) - peek) * share}px`;
    });
  }, []);

  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollTo = (index: number, immediate = false) => {
    viewport.current?.scrollTo({
      left: index * step,
      behavior: immediate || reducedMotion() ? 'instant' : 'smooth',
    });
  };

  const navigation = useRef({ editing, step, cards });
  navigation.current = { editing, step, cards };

  const settle = useCallback(() => {
    clearTimeout(settleTimer.current);
    const el = viewport.current;
    const { step, cards } = navigation.current;
    if (!el || touching.current || mouse.current?.moved) return;
    const index = Math.max(
      0,
      Math.min(cards.length - 1, Math.round(el.scrollLeft / step)),
    );
    // A snap that has not started yet would otherwise expand a widget that is still moving.
    if (Math.abs(el.scrollLeft - index * step) > 2 && settleTries.current < 4) {
      settleTries.current += 1;
      settleTimer.current = setTimeout(settle, SETTLE_MS);
      return;
    }
    settleTries.current = 0;
    restIndex.current = index;
    const card = cards[index];
    if (card) setSelectedId(card.id);
    setMoving(false);
  }, []);
  const scheduleSettle = useCallback(
    (delay = SETTLE_MS) => {
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(settle, delay);
    },
    [settle],
  );

  const select = (index: number) => {
    const card = cards[index];
    if (!card) return;
    setSelectedId(card.id);
    if (index !== Math.round(progress.current) && !editing) {
      setMoving(true);
      // Normally the scroll events re-arm this; it only covers a scroll that never happens.
      scheduleSettle(800);
    }
    scrollTo(index);
  };

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Re-anchor on the selected widget whenever the geometry or the order changes.
  useLayoutEffect(() => {
    if (!width) return;
    if (!editing) {
      progress.current = Math.max(0, activeIndex);
      restIndex.current = progress.current;
      viewport.current?.scrollTo({
        left: progress.current * step,
        behavior: 'instant',
      });
    }
    applyLayout(progress.current);
    // activeIndex is read on purpose only when the geometry or order changes.
  }, [width, step, order, editing, applyLayout]);

  useEffect(() => {
    if (editing) setMoving(false);
  }, [editing]);

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
    const ended = () => settle();
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('scrollend', ended);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('scrollend', ended);
      clearTimeout(settleTimer.current);
    };
  }, [settle]);

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
    el.style.scrollSnapType = 'x mandatory';
    select(index);
  };

  if (!count) return null;
  return (
    <section aria-label="Home widgets" aria-roledescription="carousel">
      <div
        ref={viewport}
        className={`widget-carousel-viewport overflow-x-auto ${editing ? '' : 'cursor-grab'} ${dragging ? 'cursor-grabbing select-none' : ''}`}
        style={{ scrollSnapType: editing || dragging ? 'none' : 'x mandatory' }}
        tabIndex={editing ? -1 : 0}
        aria-label={`${cards[activeIndex]?.title} selected. Scroll or use left and right arrow keys to browse widgets.`}
        onScroll={(event) => {
          if (!width) return;
          const left = event.currentTarget.scrollLeft;
          const p = Math.max(0, Math.min(count - 1, left / step));
          progress.current = p;
          applyLayout(p);
          if (editing) return;
          if (Math.abs(p - restIndex.current) * step > MOVE_SLOP_PX)
            setMoving(true);
          // The footer names the widget nearest the middle while the strip is still moving.
          const card = cards[Math.round(p)];
          if (card && card.id !== activeId) setSelectedId(card.id);
          scheduleSettle();
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
          touching.current = true;
          clearTimeout(settleTimer.current);
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
        onTouchEnd={(event) => {
          touch.current = null;
          if (event.touches.length) return;
          touching.current = false;
          // Released exactly on a snap point, no further scroll event will arrive.
          if (!editing) scheduleSettle();
        }}
        onTouchCancel={() => {
          touch.current = null;
          touching.current = false;
          if (!editing) scheduleSettle();
        }}
      >
        <div
          className="relative"
          style={{
            width: width ? width + (count - 1) * step : undefined,
          }}
        >
          {/* One snap point per widget; the spacer only exists to be scrolled. */}
          {cards.map((card, index) => (
            <span
              key={card.id}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 h-px w-px"
              style={{ left: index * step, scrollSnapAlign: 'start' }}
            />
          ))}
          <div
            ref={stage}
            className="sticky left-0 overflow-x-clip"
            style={{ width: width || undefined }}
          >
            <SortableGrid
              items={cards}
              getId={(card) => card.id}
              getLabel={(card) => card.title}
              editing={editing}
              onEditingChange={onEditingChange}
              onOrderChange={onOrderChange}
              onCommit={onCommit}
              className="flex h-[184px] items-stretch"
              getItemStyle={(_card, index) =>
                ({
                  flexShrink: 0,
                  marginRight: index < count - 1 ? gap : 0,
                  // The faces are laid out at their final sizes, so they never reflow.
                  '--widget-full': `${restWidth(index)}px`,
                  '--widget-peek': `${peek}px`,
                }) as CSSProperties
              }
            >
              {(card, state) =>
                children(
                  card,
                  state,
                  card.id === activeId && (editing || !moving),
                  () => select(state.index),
                )
              }
            </SortableGrid>
          </div>
        </div>
      </div>
      {count > 1 && (
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
            {cards[activeIndex]?.title} · {activeIndex + 1} / {count}
          </span>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:text-ink disabled:opacity-25"
            disabled={activeIndex >= count - 1 || editing}
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
