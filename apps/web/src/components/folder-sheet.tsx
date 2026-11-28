'use client';

import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * A panel that opens like an iOS folder: it starts as the thing that was tapped (`from`) and grows
 * into place over a blurred screen. A portal widget and the identity chooser on the Portal tab
 * both open this way. Centred between the top chrome and the tab bar; a long one scrolls inside.
 */
export function FolderSheet({
  from,
  label,
  icon,
  aside,
  onClose,
  children,
}: {
  from: DOMRect;
  label: string;
  /** A tile beside the title. */
  icon?: ReactNode;
  /** Small text before the close button, e.g. who sees it. */
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  // Starts as what it came from, then grows into place.
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const to = node.getBoundingClientRect();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && to.width && to.height) {
      node.style.transformOrigin = 'top left';
      node.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
      node.getBoundingClientRect();
    }
    requestAnimationFrame(() => {
      node.style.transition = 'transform 320ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 200ms';
      node.style.transform = '';
      setShown(true);
    });
  }, [from]);
  useEffect(() => {
    const esc = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={label} data-no-tab-swipe>
      <button
        type="button"
        aria-label="Close"
        className={clsx('absolute inset-0 bg-surface/50 backdrop-blur-xl transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0')}
        onClick={onClose}
      />
      <div
        ref={panel}
        className="card home-widget absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] top-[max(4rem,calc(var(--top-chrome,0px)+3rem))] mx-auto my-auto flex h-fit max-h-[78vh] max-w-2xl flex-col overflow-hidden rounded-3xl shadow-2xl"
      >
        <header className="flex items-center gap-2.5 px-4 pb-2 pt-4">
          {icon}
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{label}</h2>
          {aside && <span className="shrink-0 text-xs text-ink-faint">{aside}</span>}
          <button type="button" aria-label="Close" className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink-muted" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
