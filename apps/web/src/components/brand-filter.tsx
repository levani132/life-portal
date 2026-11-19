'use client';

import clsx from 'clsx';
import { useBrands, useTopBrands } from '../lib/brands';
import { BrandMark } from './brand-mark';

/**
 * The brands a person uses most, as chips with their logos: tap one to see only its foods, tap
 * it again to see everything. Up to five; nothing is drawn when the person has no branded food.
 */
export function BrandFilter({
  foods,
  value,
  onChange,
  className,
}: {
  foods: readonly { brand?: string; useCount?: number; archived?: boolean }[];
  /** The chosen brand's key, or null for every brand. */
  value: string | null;
  onChange: (key: string | null) => void;
  className?: string;
}) {
  const top = useTopBrands(foods, 5);
  const { find } = useBrands();
  if (!top.length) return null;
  return (
    <div className={clsx('flex gap-1.5 overflow-x-auto [scrollbar-width:none]', className)} role="group" aria-label="Brand" data-no-tab-swipe>
      {top.map(({ key, name }) => {
        const brand = find(name);
        const label = brand?.name ?? name;
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? null : key)}
            className={clsx(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-full border pl-1.5 pr-3 text-xs font-medium transition',
              selected ? 'border-accent bg-accent/10 text-ink' : 'border-border text-ink-muted hover:text-ink',
            )}
          >
            <BrandMark name={label} brand={brand} size={20} className="rounded-full" />
            <span className="max-w-[7rem] truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
