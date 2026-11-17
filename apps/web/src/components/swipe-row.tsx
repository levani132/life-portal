'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SwipeAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** The destructive action: red, last, and the one a full swipe runs. */
  danger?: boolean;
  disabled?: boolean;
}

const ACTION_WIDTH = 56;
/** How far the finger must travel sideways before the row, not the page, owns the gesture. */
const LOCK_PX = 8;
/** A swipe past this share of the row's width is a full swipe. */
const FULL_SHARE = 0.6;

/** Where a released row settles: closed, open on its actions, or all the way (the full swipe). */
export function settle(offset: number, actionsWidth: number, rowWidth: number, canFull: boolean): 'closed' | 'open' | 'full' {
  if (canFull && rowWidth > 0 && -offset >= rowWidth * FULL_SHARE) return 'full';
  return -offset >= actionsWidth / 2 ? 'open' : 'closed';
}

/**
 * A row whose actions sit behind it, as in iOS lists: swipe left to reveal them, swipe most of
 * the way to run the destructive one. Touch only. Pointer devices keep visible buttons (the
 * caller renders them with `.pointer-fine-flex`), so nothing is reachable by swiping alone.
 *
 * The same rules as the app's other gestures: the non-passive `touchmove` listener is attached
 * when the row mounts (a browser that finds none at `touchstart` hands the gesture to the
 * compositor), the row is `data-no-tab-swipe` so the tabs never take a swipe that starts on it,
 * and a mostly vertical move is left alone for scrolling and pull-to-refresh.
 */
export function SwipeRow({
  actions,
  children,
  className,
}: {
  actions: SwipeAction[];
  children: ReactNode;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ x: number; y: number; base: number; locked: boolean | null } | null>(null);
  const live = useRef({ offset: 0, actions });
  live.current = { offset, actions };
  const actionsWidth = actions.length * ACTION_WIDTH;
  // Past the actions' own width the last one stretches with the finger, so no gap opens.
  const stretch = Math.max(0, -offset - actionsWidth);
  const open = offset < 0;
  const settleBack = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(settleBack.current), []);

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const width = () => el.offsetWidth;
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      gesture.current = { x: touch.clientX, y: touch.clientY, base: live.current.offset, locked: null };
    };
    const move = (event: TouchEvent) => {
      const state = gesture.current;
      if (!state) return;
      const touch = event.touches[0];
      const dx = touch.clientX - state.x;
      const dy = touch.clientY - state.y;
      if (state.locked === null) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
        // Sideways, and to the left unless the row is already open: otherwise it is a scroll.
        state.locked = Math.abs(dx) > Math.abs(dy) && (dx < 0 || state.base < 0);
        if (state.locked) setDragging(true);
      }
      if (!state.locked) return;
      event.preventDefault();
      setOffset(Math.max(-width(), Math.min(0, state.base + dx)));
    };
    const end = () => {
      const state = gesture.current;
      gesture.current = null;
      if (!state?.locked) return;
      setDragging(false);
      const current = live.current;
      const dangerous = current.actions.find((action) => action.danger && !action.disabled);
      const next = settle(current.offset, current.actions.length * ACTION_WIDTH, width(), !!dangerous);
      if (next === 'full' && dangerous) {
        setOffset(-width());
        dangerous.onClick();
        // The row normally leaves the list. If the action failed and it is still here, bring it back.
        settleBack.current = setTimeout(() => setOffset(0), 900);
      } else {
        setOffset(next === 'open' ? -current.actions.length * ACTION_WIDTH : 0);
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  // An open row closes when anything else is touched.
  useEffect(() => {
    if (!open) return;
    const close = (event: TouchEvent) => {
      if (!row.current?.contains(event.target as Node)) setOffset(0);
    };
    document.addEventListener('touchstart', close, { passive: true });
    return () => document.removeEventListener('touchstart', close);
  }, [open]);

  return (
    <div ref={row} className={clsx('relative overflow-hidden', className)} data-no-tab-swipe>
      <div className="absolute inset-y-0 right-0 flex" aria-hidden={!open}>
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              tabIndex={open ? 0 : -1}
              disabled={action.disabled}
              aria-label={action.label}
              title={action.label}
              onClick={() => {
                setOffset(0);
                action.onClick();
              }}
              style={{ width: ACTION_WIDTH + (index === actions.length - 1 ? stretch : 0) }}
              className={clsx(
                'flex shrink-0 items-center justify-center text-white disabled:opacity-50',
                action.danger ? 'bg-rose-600' : 'bg-ink-faint/60',
              )}
            >
              <Icon size={18} aria-hidden />
            </button>
          );
        })}
      </div>
      <div
        className={clsx('relative', !dragging && 'transition-transform duration-200 ease-out motion-reduce:transition-none')}
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
