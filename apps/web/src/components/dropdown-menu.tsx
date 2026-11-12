'use client';
import clsx from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface DropdownItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  /** Shows a tick: the current choice in a "View as" style list. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * A small menu that opens under its button: the profile's "…" and "View as". Closes on a choice,
 * an outside tap or Escape. It is absolutely positioned (not fixed), so it scrolls with the page
 * and a sideways swipe that starts on it still belongs to the tab.
 */
export function DropdownMenu({
  label,
  trigger,
  items,
  align = 'right',
  triggerClassName,
}: {
  /** The button's accessible name. */
  label: string;
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={root} className="relative w-fit">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={triggerClassName}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className={clsx(
            'absolute top-full z-40 mt-1 min-w-48 overflow-hidden rounded-xl border border-border bg-surface-raised py-1 shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              disabled={item.disabled}
              className={clsx(
                'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface disabled:opacity-50',
                item.danger ? 'text-rose-300' : 'text-ink',
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon && <span className="shrink-0 text-ink-muted">{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
              {item.checked && <Check size={16} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
