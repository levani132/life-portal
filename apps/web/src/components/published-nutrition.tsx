import type { PublishedFood, PublishedMacros } from '@life-portal/shared-types';
import { MACRO_TEXT } from '../lib/macro-colors';
import { publicationMacros } from '@life-portal/shared-domain';

const metrics = [
  {
    key: 'energyKcal',
    label: 'Energy',
    unit: 'kcal',
    color: MACRO_TEXT.kcal,
  },
  { key: 'proteinG', label: 'Protein', unit: 'g', color: MACRO_TEXT.protein },
  { key: 'carbG', label: 'Carbs', unit: 'g', color: MACRO_TEXT.carbs },
  { key: 'fatG', label: 'Fat', unit: 'g', color: MACRO_TEXT.fat },
] as const;
const number = (value: number) => Math.round(value * 10) / 10;

export function PublishedNutritionSummary({
  totals,
  targets,
  diary = false,
}: {
  totals?: PublishedMacros;
  targets?: Partial<PublishedMacros>;
  diary?: boolean;
}) {
  if (!totals) return null;
  return (
    <div className="mt-3">
      {diary && (
        <p className="mb-2 text-[11px] text-ink-muted">Logged / daily target</p>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map(({ key, label, unit, color }) => {
          const actual = totals[key];
          const target = targets?.[key];
          const hasTarget =
            target !== undefined && Number.isFinite(target) && target > 0;
          const progress = hasTarget
            ? Math.min(1, Math.max(0, actual / target))
            : 0;
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-lg bg-violet-500/5 p-2"
            >
              {diary && (
                <svg
                  viewBox="0 0 44 44"
                  className={`h-10 w-10 shrink-0 ${color}`}
                  role="img"
                  aria-label={`${label}: ${number(actual)} ${unit}${hasTarget ? ` of ${number(target)} ${unit}` : ', target unavailable'}`}
                >
                  <circle
                    cx="22"
                    cy="22"
                    r="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    opacity="0.15"
                  />
                  {hasTarget && (
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${progress * 113.1} 113.1`}
                      transform="rotate(-90 22 22)"
                    />
                  )}
                </svg>
              )}
              <div className="min-w-0">
                <dt className="text-[10px] text-ink-muted">{label}</dt>
                <dd className="text-xs font-semibold tabular-nums">
                  {number(actual)}{' '}
                  <span className="font-normal text-ink-muted">{unit}</span>
                </dd>
                {diary && (
                  <dd className="text-[10px] text-ink-muted">
                    {hasTarget
                      ? `/ ${number(target)} ${unit}`
                      : 'No saved target'}
                  </dd>
                )}
              </div>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function PublishedFoodMacros({ food }: { food: PublishedFood }) {
  const totals = publicationMacros([{ ...food, amount: food.amount ?? 100 }]);
  if (!totals) return null;
  return (
    <p className="mt-1 text-xs text-ink-muted">
      <span className={MACRO_TEXT.kcal}>{number(totals.energyKcal)} kcal</span> ·{' '}
      <span className={MACRO_TEXT.protein}>P {number(totals.proteinG)}g</span>
      {' · '}
      <span className={MACRO_TEXT.carbs}>C {number(totals.carbG)}g</span>
      {' · '}
      <span className={MACRO_TEXT.fat}>F {number(totals.fatG)}g</span>
      {food.amount === undefined && <span> · per 100 {food.unit}</span>}
    </p>
  );
}
