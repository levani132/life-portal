'use client';

import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * A photo on the whole screen: a profile photo, opened from the profile. Tap anywhere, the ✕ or
 * Escape to close. Rendered at the document's root so no tab's transform or overflow clips it.
 */
export function PhotoViewer({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      data-no-tab-swipe
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute right-4 top-[calc(var(--top-chrome)+0.75rem)] flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white"
        onClick={onClose}
      >
        <X size={22} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link */}
      <img src={url} alt={alt} className="max-h-full max-w-full rounded-2xl object-contain" />
    </div>,
    document.body,
  );
}
