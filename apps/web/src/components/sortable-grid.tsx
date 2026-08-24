'use client';

import clsx from 'clsx';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { moveWidget } from '@life-portal/shared-domain';

/**
 * Long-press-to-rearrange, the way a phone home screen does it.
 *
 * Written by hand rather than pulled in from a drag-and-drop library because the whole
 * behaviour is one gesture on one grid, and the libraries that do this well are larger than
 * this file. What it has to get right is all in the touch handling:
 *
 * - **A press is not a scroll.** The card lifts only after the finger has been still for
 *   `LONG_PRESS_MS`; any movement past `SCROLL_SLOP_PX` before that cancels the press and the
 *   page scrolls as usual. This is also why the lift cannot be immediate — every card fills
 *   most of a phone's width, so a scroll gesture almost always starts on one.
 * - **The page must not scroll once a card is lifted.** `touch-action` is decided when the
 *   gesture starts, so switching it mid-gesture would do nothing; a non-passive `touchmove`
 *   listener calling `preventDefault()` is what actually holds the page still. That listener sits
 *   on the grid for as long as it is mounted, and *not* added when a card is picked up: a browser
 *   whose hit test finds no cancellable listener at `touchstart` hands the gesture to the
 *   compositor and answers the first move with `pointercancel`, which is precisely a drag that
 *   dies the moment it begins. Measured, not guessed — see docs/DECISIONS.md.
 * - **The card has to stay under the finger** even though the grid reflows under it. Its
 *   transform is recomputed from its *current* slot on every move (see `sync`), so a card whose
 *   slot just moved does not jump.
 *
 * Everything else follows from those: the other cards animate to their new slots with a FLIP
 * (measure, invert, transition), the dragged card is excluded from that because the pointer
 * already places it, and every measurement subtracts the element's live transform so a card
 * measured mid-animation still reports the slot it is heading for.
 */

/** Hold this long before a card lifts, when the dashboard is not in edit mode yet. */
const LONG_PRESS_MS = 420;
/** Once in edit mode the intent is established, so a card lifts almost at once. */
const EDIT_PRESS_MS = 130;
/** Moving further than this before the timer fires means "scroll", not "pick up". */
const SCROLL_SLOP_PX = 10;
/** A mouse in edit mode needs no hold at all — this is the distance that starts the drag. */
const MOUSE_SLOP_PX = 4;
/** Dragging within this far of the top or bottom edge scrolls the page. */
const EDGE_PX = 76;
const EDGE_SPEED_PX = 16;
/** Long enough to read as a movement, short enough not to lag behind a fast rearrange. */
const SETTLE_MS = 200;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the caller needs to know to style a card while it is being rearranged. */
export interface SortableState {
  index: number;
  editing: boolean;
  dragging: boolean;
}

interface SortableGridProps<T> {
  /** In display order. The grid never sorts; it reports the order it wants and re-renders. */
  items: readonly T[];
  getId: (item: T) => string;
  /** Used for the accessible name of the drag target, e.g. "Debts". */
  getLabel: (item: T) => string;
  editing: boolean;
  /** A long press outside edit mode turns it on, the same as picking an app up on iOS. */
  onEditingChange: (editing: boolean) => void;
  /** Fires continuously while dragging: the caller holds the order, this only proposes it. */
  onOrderChange: (ids: string[]) => void;
  /** Fires once the card is dropped, or once per keyboard move — the moment worth saving. */
  onCommit: (ids: string[]) => void;
  className?: string;
  children: (item: T, state: SortableState) => ReactNode;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * The translation currently painted on the element, read back from the computed style so a
 * value mid-transition is exact. Read rather than remembered: these elements are moved by three
 * different things (the drag, the FLIP, the settle) and bookkeeping would have to agree with
 * all of them.
 */
function readTranslate(el: HTMLElement): { x: number; y: number } {
  const value = getComputedStyle(el).transform;
  if (!value || value === 'none') return { x: 0, y: 0 };
  try {
    const matrix = new DOMMatrixReadOnly(value);
    return { x: matrix.e, y: matrix.f };
  } catch {
    return { x: 0, y: 0 };
  }
}

/** Where the element's grid slot is, with any transform taken back off. */
function layoutBox(el: HTMLElement): Box {
  const rect = el.getBoundingClientRect();
  const { x, y } = readTranslate(el);
  return { left: rect.left - x, top: rect.top - y, right: rect.right - x, bottom: rect.bottom - y };
}

export function SortableGrid<T>({
  items,
  getId,
  getLabel,
  editing,
  onEditingChange,
  onOrderChange,
  onCommit,
  className,
  children,
}: SortableGridProps<T>) {
  const [dragId, setDragId] = useState<string | null>(null);

  const ids = items.map(getId);

  // Everything the pointer handlers read is kept in refs: they are window listeners, attached
  // once per gesture, and must not see the props as they were when the gesture began.
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const callbacks = useRef({ onOrderChange, onCommit, onEditingChange });
  callbacks.current = { onOrderChange, onCommit, onEditingChange };

  const grid = useRef<HTMLDivElement | null>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());

  /** The press being timed. Becomes a drag when the timer fires, or nothing if it is cancelled. */
  const press = useRef<{
    id: string;
    el: HTMLDivElement;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    mouse: boolean;
    timer: number;
  } | null>(null);

  const drag = useRef<{
    id: string;
    el: HTMLDivElement;
    pointerId: number;
    /** Where in the card the finger took hold, relative to the card's own box. */
    grabX: number;
    grabY: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  /** The card the pointer is currently over, so entering it swaps exactly once. */
  const hoverLock = useRef<string | null>(null);
  /** Slot positions taken just before a reorder, for the FLIP that follows it. */
  const before = useRef<Map<string, Box> | null>(null);
  const frame = useRef(0);
  /** A long press ends in a click the browser still wants to deliver to the card's link. */
  const suppressClick = useRef(false);
  const pointerType = useRef<string>('mouse');

  /** Records where every card sits now, so the next render can animate the difference. */
  const captureSlots = useCallback(() => {
    const boxes = new Map<string, Box>();
    elements.current.forEach((el, id) => {
      // The dragged card is placed by the pointer, so it must not be animated as well.
      if (id === drag.current?.id) return;
      boxes.set(id, layoutBox(el));
    });
    before.current = boxes;
  }, []);

  /** Places the dragged card under the pointer, then reorders if it is over another card. */
  const sync = useCallback(() => {
    const current = drag.current;
    if (!current) return;

    // The slot is recovered from the live rect rather than remembered, because a reorder or an
    // auto-scroll may have moved it since the last frame.
    const slot = layoutBox(current.el);
    const x = current.clientX - current.grabX - slot.left;
    const y = current.clientY - current.grabY - slot.top;
    current.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    const order = idsRef.current;
    const from = order.indexOf(current.id);
    if (from < 0) return;

    let hoveredIndex = -1;
    for (let index = 0; index < order.length; index++) {
      if (index === from) continue;
      const el = elements.current.get(order[index]);
      if (!el) continue;
      const box = layoutBox(el);
      if (
        current.clientX >= box.left &&
        current.clientX <= box.right &&
        current.clientY >= box.top &&
        current.clientY <= box.bottom
      ) {
        hoveredIndex = index;
        break;
      }
    }

    /*
     * Swap once per card entered, not once per frame spent over it. Cards are different heights,
     * so a swap moves the card underneath the finger too — without this the pointer would still
     * be inside the neighbour it just displaced and the two would trade places every frame. The
     * lock clears as soon as the finger is over something else, or over nothing.
     */
    const hovered = hoveredIndex < 0 ? null : order[hoveredIndex];
    if (hovered === hoverLock.current) return;
    hoverLock.current = hovered;
    if (hoveredIndex < 0) return;

    captureSlots();
    callbacks.current.onOrderChange(moveWidget(order, from, hoveredIndex));
  }, [captureSlots]);

  /** FLIP: invert the move that just happened, then transition the inversion away. */
  useLayoutEffect(() => {
    const previous = before.current;
    before.current = null;
    if (!previous || prefersReducedMotion()) return;

    const moved: HTMLDivElement[] = [];
    previous.forEach((box, id) => {
      const el = elements.current.get(id);
      if (!el || id === drag.current?.id) return;
      const now = layoutBox(el);
      const dx = box.left - now.left;
      const dy = box.top - now.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      moved.push(el);
    });
    if (!moved.length) return;

    const handle = requestAnimationFrame(() => {
      for (const el of moved) {
        el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
        el.style.transform = '';
      }
    });
    return () => cancelAnimationFrame(handle);
  });

  const autoScroll = useCallback(() => {
    const current = drag.current;
    if (!current) return;

    const height = window.innerHeight;
    let delta = 0;
    if (current.clientY < EDGE_PX) {
      delta = -EDGE_SPEED_PX * (1 - current.clientY / EDGE_PX);
    } else if (current.clientY > height - EDGE_PX) {
      delta = EDGE_SPEED_PX * (1 - (height - current.clientY) / EDGE_PX);
    }
    if (delta) {
      window.scrollBy(0, delta);
      sync();
    }
    frame.current = requestAnimationFrame(autoScroll);
  }, [sync]);

  /**
   * Registered non-passive on the grid for as long as it is mounted, because a browser decides
   * whether a touch gesture can be cancelled at `touchstart` — see the note at the top. It does
   * nothing at all unless a card is actually being dragged, so scrolling the dashboard with a
   * finger is untouched.
   *
   * A touch's events keep going to the element the touch started on, so a listener on the grid
   * sees every move of a drag that began on one of its cards. It also carries the coordinates:
   * some browsers stop the pointer stream for a gesture they have already handed over.
   */
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const onTouchMove = (event: TouchEvent) => {
      const current = drag.current;
      if (!current) return;
      event.preventDefault();
      const touch = event.touches[0];
      if (!touch) return;
      current.clientX = touch.clientX;
      current.clientY = touch.clientY;
      sync();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [sync]);

  const cancelPress = useCallback(() => {
    if (press.current?.timer) window.clearTimeout(press.current.timer);
    press.current = null;
  }, []);

  const endDrag = useCallback(
    (commit: boolean) => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      setDragId(null);

      cancelAnimationFrame(frame.current);
      document.body.style.removeProperty('user-select');
      try {
        current.el.releasePointerCapture(current.pointerId);
      } catch {
        // Capture may already be gone; releasing it is a courtesy either way.
      }

      // Glide into the slot rather than snapping to it.
      current.el.style.transition = prefersReducedMotion()
        ? 'none'
        : `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
      current.el.style.transform = '';

      if (commit) callbacks.current.onCommit(idsRef.current);
    },
    [],
  );

  const beginDrag = useCallback(
    (id: string, el: HTMLDivElement, pointerId: number, clientX: number, clientY: number) => {
      const box = layoutBox(el);
      drag.current = {
        id,
        el,
        pointerId,
        grabX: clientX - box.left,
        grabY: clientY - box.top,
        clientX,
        clientY,
      };
      setDragId(id);
      suppressClick.current = true;
      hoverLock.current = null;

      // No transition on the card being dragged: it belongs to the finger, not to an easing.
      el.style.transition = 'none';
      el.style.transform = 'translate3d(0px, 0px, 0)';
      try {
        el.setPointerCapture(pointerId);
      } catch {
        // Window listeners already cover the case where capture is unavailable.
      }
      document.body.style.setProperty('user-select', 'none');
      navigator.vibrate?.(8);

      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(autoScroll);
    },
    [autoScroll],
  );

  // One set of window listeners for the whole gesture: a finger that slides off the card it
  // started on, or a pointer capture the browser takes back, must not leave a card stuck.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = drag.current;
      if (current && current.pointerId === event.pointerId) {
        current.clientX = event.clientX;
        current.clientY = event.clientY;
        sync();
        return;
      }

      const pending = press.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      pending.x = event.clientX;
      pending.y = event.clientY;
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);

      if (pending.mouse && editingRef.current) {
        if (distance > MOUSE_SLOP_PX) {
          cancelPress();
          beginDrag(pending.id, pending.el, pending.pointerId, event.clientX, event.clientY);
        }
        return;
      }
      if (distance > SCROLL_SLOP_PX) cancelPress();
    };

    const onUp = (event: PointerEvent) => {
      if (drag.current?.pointerId === event.pointerId) endDrag(true);
      else if (press.current?.pointerId === event.pointerId) cancelPress();
    };

    const onCancel = (event: PointerEvent) => {
      // A cancelled pointer still leaves the cards where the user last saw them, so the
      // arrangement is worth saving.
      if (drag.current?.pointerId === event.pointerId) endDrag(true);
      else if (press.current?.pointerId === event.pointerId) cancelPress();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [beginDrag, cancelPress, endDrag, sync]);

  // Dropping out of edit mode (or unmounting) mid-drag must not leave the page unscrollable.
  useEffect(() => {
    if (editing) return;
    cancelPress();
    endDrag(false);
  }, [editing, cancelPress, endDrag]);

  useEffect(
    () => () => {
      cancelPress();
      cancelAnimationFrame(frame.current);
      document.body.style.removeProperty('user-select');
    },
    [cancelPress],
  );

  const onPointerDown = (id: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // A press that starts on the card's quick action is that button's, not the grid's.
    if ((event.target as HTMLElement).closest('button')) return;
    const el = elements.current.get(id);
    if (!el) return;

    pointerType.current = event.pointerType;
    suppressClick.current = false;
    cancelPress();

    const mouse = event.pointerType === 'mouse';
    const pending = {
      id,
      el,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      mouse,
      timer: 0,
    };
    press.current = pending;

    // A mouse already in edit mode drags on movement alone; everything else is a hold.
    if (mouse && editing) return;

    pending.timer = window.setTimeout(
      () => {
        press.current = null;
        if (!editingRef.current) callbacks.current.onEditingChange(true);
        beginDrag(pending.id, pending.el, pending.pointerId, pending.x, pending.y);
      },
      editing ? EDIT_PRESS_MS : LONG_PRESS_MS,
    );
  };

  const onKeyDown = (id: string) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : 0;
    if (!step) return;

    const order = idsRef.current;
    const from = order.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= order.length) return;

    event.preventDefault();
    captureSlots();
    const next = moveWidget(order, from, to);
    onOrderChange(next);
    onCommit(next);
  };

  return (
    <div
      ref={grid}
      className={className}
      role="list"
      onClickCapture={(event) => {
        // The click that follows a long press would otherwise open the card's link.
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {items.map((item, index) => {
        const id = getId(item);
        const dragging = dragId === id;
        return (
          <div
            key={id}
            role="listitem"
            ref={(node) => {
              if (node) elements.current.set(id, node);
              else elements.current.delete(id);
            }}
            tabIndex={editing ? 0 : undefined}
            aria-label={editing ? `${getLabel(item)}, arrow keys move it` : undefined}
            onPointerDown={onPointerDown(id)}
            onKeyDown={editing ? onKeyDown(id) : undefined}
            onDragStart={(event) => event.preventDefault()}
            onContextMenu={(event) => {
              // A long press on a touch screen must not raise the link preview or a menu.
              if (pointerType.current !== 'mouse') event.preventDefault();
            }}
            className={clsx(
              'widget-slot relative',
              editing && 'select-none focus-visible:outline-none',
              dragging && 'z-30',
            )}
          >
            {children(item, { index, editing, dragging })}
          </div>
        );
      })}
    </div>
  );
}
