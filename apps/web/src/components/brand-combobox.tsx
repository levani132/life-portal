'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND_NAME_MAX } from '@life-portal/shared-types';
import { brandKey, cleanBrandName } from '@life-portal/shared-domain';
import { useBrands } from '../lib/brands';
import { BrandMark } from './brand-mark';
import { Input } from './ui';

/**
 * A food's brand: type to find an existing one (public brands and the person's own, with their
 * logos), or type a new name, which becomes the person's own brand when the food is saved.
 *
 * A name that is an existing brand in any spelling ("mcdonalds") snaps to that brand
 * ("McDonald's"), so the same brand is never entered twice. The server applies the same rule,
 * so it holds with no connection too.
 */
export function BrandCombobox({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const { brands, find } = useBrands();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const typedKey = brandKey(value);
  const exact = typedKey ? find(value) : undefined;

  const matches = useMemo(() => {
    if (!typedKey) return brands.slice(0, 8);
    const starts = brands.filter((brand) => brand.key.startsWith(typedKey));
    const contains = brands.filter((brand) => !brand.key.startsWith(typedKey) && brand.key.includes(typedKey));
    return [...starts, ...contains].slice(0, 8);
  }, [brands, typedKey]);

  // A press outside closes the list (pointer events: iOS does not focus a tapped button).
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
    // `close` reads the latest value through the closure of this render.
  });

  /** Leaving the field: any spelling of an existing brand becomes that brand. */
  function close() {
    setOpen(false);
    const match = find(value);
    const next = match ? match.name : cleanBrandName(value);
    if (next !== value) onChange(next);
  }

  return (
    <div ref={root} className="relative">
      <div className="relative">
        {value.trim() && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
            <BrandMark name={exact?.name ?? value} brand={exact} size={22} />
          </span>
        )}
        <Input
          value={value}
          maxLength={BRAND_NAME_MAX}
          placeholder="Type to find or add a brand"
          role="combobox"
          aria-expanded={open}
          aria-controls="brand-combobox-list"
          aria-autocomplete="list"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && open) {
              // Enter takes the first match; it never submits the food form from here.
              event.preventDefault();
              if (matches[0] && typedKey) onChange(matches[0].name);
              setOpen(false);
            } else if (event.key === 'Escape' && open) {
              event.stopPropagation();
              close();
            }
          }}
          className={clsx(value.trim() && 'pl-10')}
        />
      </div>
      {open && (matches.length > 0 || typedKey) && (
        <ul
          id="brand-combobox-list"
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface-raised p-1 shadow-lg"
        >
          {matches.map((brand) => (
            <li key={brand.id} role="option" aria-selected={brand.key === typedKey}>
              <button
                type="button"
                onClick={() => {
                  onChange(brand.name);
                  setOpen(false);
                }}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-surface',
                  brand.key === typedKey && 'bg-surface',
                )}
              >
                <BrandMark name={brand.name} brand={brand} size={24} />
                <span className="min-w-0 flex-1 truncate">{brand.name}</span>
                {brand.scope === 'own' && <span className="shrink-0 text-[10px] text-ink-faint">yours</span>}
              </button>
            </li>
          ))}
          {typedKey && !exact && (
            <li className="border-t border-border px-2 py-2 text-xs text-ink-muted">
              “{cleanBrandName(value)}” will be saved as your own brand.
            </li>
          )}
          {exact && exact.name !== cleanBrandName(value) && (
            <li className="border-t border-border px-2 py-2 text-xs text-ink-muted">
              This is {exact.name}: it will be saved under that name.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
