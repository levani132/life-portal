import clsx from 'clsx';
import type { FoodBrand } from '@life-portal/shared-types';

/** Tints for a brand with no logo: its initial on one of the theme's six hues, picked by name. */
const TINTS = [
  'bg-train-push/15 text-train-push',
  'bg-train-pull/15 text-train-pull',
  'bg-train-legs/15 text-train-legs',
  'bg-train-core/15 text-train-core',
  'bg-train-arms/15 text-train-arms',
  'bg-train-cardio/15 text-train-cardio',
];

function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value;
}

/**
 * A brand's mark: its logo, or its initial on a tint when it has none. Decoration beside the
 * brand's name, so it is hidden from screen readers.
 */
export function BrandMark({
  name,
  brand,
  size = 20,
  className,
}: {
  name: string;
  brand?: Pick<FoodBrand, 'logoUrl'>;
  size?: number;
  className?: string;
}) {
  const box = { width: size, height: size };
  if (brand?.logoUrl)
    return (
      // A signed link that changes on every read: a plain <img>, never the optimiser.
      <img
        src={brand.logoUrl}
        alt=""
        aria-hidden
        loading="lazy"
        style={box}
        className={clsx('shrink-0 rounded-md bg-white object-contain', className)}
      />
    );
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <span
      aria-hidden
      style={{ ...box, fontSize: Math.max(9, Math.round(size * 0.5)) }}
      className={clsx('flex shrink-0 items-center justify-center rounded-md font-bold leading-none', TINTS[hash(name.toLowerCase()) % TINTS.length], className)}
    >
      {letter}
    </span>
  );
}
