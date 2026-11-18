import clsx from 'clsx';
import { macroShares } from '@life-portal/shared-domain';
import { MACRO_COLORS } from '../lib/macro-colors';

const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Where the calories come from: one slim line split into protein, carbs and fat by their share
 * of the energy, each in its macro's colour. The same line on a food's card, in the food
 * chooser and under each meal of the day. Nothing is drawn when there are no macros.
 */
export function MacroSplit({
  macros,
  className,
}: {
  macros: { proteinMg: number; carbMg: number; fatMg: number };
  className?: string;
}) {
  const shares = macroShares(macros);
  if (!(shares.protein + shares.carbs + shares.fat > 0)) return null;
  return (
    <span
      className={clsx('flex h-1.5 overflow-hidden rounded-full bg-border', className)}
      role="img"
      aria-label={`Calories from protein ${pct(shares.protein)}, carbs ${pct(shares.carbs)}, fat ${pct(shares.fat)}`}
    >
      <span style={{ width: pct(shares.protein), background: MACRO_COLORS.protein }} />
      <span style={{ width: pct(shares.carbs), background: MACRO_COLORS.carbs }} />
      <span style={{ width: pct(shares.fat), background: MACRO_COLORS.fat }} />
    </span>
  );
}
