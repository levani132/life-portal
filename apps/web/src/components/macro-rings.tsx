import clsx from 'clsx';
import { MACRO_COLORS, MACRO_TEXT } from '../lib/macro-colors';
import { macroShares } from '@life-portal/shared-domain';

const COLORS = MACRO_COLORS;
const R = 15.5;
const C = 2 * Math.PI * R;

/**
 * A food's numbers as rings: calories in the middle of a ring split by where they come from,
 * then protein, carbs and fat, each filled to its share of the calories. Shares rather than
 * daily targets, so the rings mean the same thing to everyone who sees a post.
 */
export function MacroRings({
  kcal,
  proteinMg,
  carbMg,
  fatMg,
  className,
}: {
  kcal: number;
  proteinMg: number;
  carbMg: number;
  fatMg: number;
  className?: string;
}) {
  const shares = macroShares({ proteinMg, carbMg, fatMg });
  const parts = [
    { key: 'protein', label: 'Protein', grams: proteinMg, share: shares.protein, color: COLORS.protein },
    { key: 'carbs', label: 'Carbs', grams: carbMg, share: shares.carbs, color: COLORS.carbs },
    { key: 'fat', label: 'Fat', grams: fatMg, share: shares.fat, color: COLORS.fat },
  ];
  let offset = 0;
  return (
    <div className={clsx('grid grid-cols-4 items-center gap-1 text-center', className)}>
      <div className="relative mx-auto aspect-square w-full max-w-[72px]" role="img" aria-label={`${kcal} kcal`}>
        <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="20" cy="20" r={R} fill="none" stroke="rgb(var(--border))" strokeWidth="4" />
          {parts.map((part) => {
            const length = part.share * C;
            const dash = (
              <circle
                key={part.key}
                cx="20"
                cy="20"
                r={R}
                fill="none"
                stroke={part.color}
                strokeWidth="4"
                strokeDasharray={`${Math.max(0, length - (part.share > 0 && part.share < 1 ? 1 : 0))} ${C}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return dash;
          })}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
          <strong className="text-sm font-semibold tabular-nums">{Math.round(kcal).toLocaleString()}</strong>
          <span className={clsx('text-[9px]', MACRO_TEXT.kcal)}>kcal</span>
        </span>
      </div>
      {parts.map((part) => (
        <div key={part.key} className="min-w-0">
          <div
            className="relative mx-auto aspect-square w-full max-w-[52px]"
            role="img"
            aria-label={`${part.label}: ${grams(part.grams)} g, ${Math.round(part.share * 100)}% of calories`}
          >
            <svg viewBox="0 0 40 40" className="h-full w-full -rotate-90" aria-hidden>
              <circle cx="20" cy="20" r={R} fill="none" stroke="rgb(var(--border))" strokeWidth="4" />
              <circle
                cx="20"
                cy="20"
                r={R}
                fill="none"
                stroke={part.color}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${part.share * C} ${C}`}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">
              {grams(part.grams)}
              <span className="text-[8px] font-normal text-ink-muted">g</span>
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-ink-muted">
            {part.label} · {Math.round(part.share * 100)}%
          </p>
        </div>
      ))}
    </div>
  );
}

function grams(mg: number) {
  const g = mg / 1000;
  return g >= 10 ? Math.round(g) : Math.round(g * 10) / 10;
}
