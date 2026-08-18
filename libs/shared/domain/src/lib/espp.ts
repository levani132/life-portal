import type {
  EsppPlan,
  EsppProjection,
  ProjectedEsppGrant,
  StockPricePoint,
} from '@life-portal/shared-types';
import { addYears, formatDay, makeDay, toDay, yearOf, type DayString } from './dates';
import { scaleCents } from './money';

/**
 * EPAM employee share purchase plan projector.
 *
 * The plan buys shares twice a year on 1 May and 1 November. Each purchase uses a
 * contribution of a fixed amount and a price of
 *
 *     min(close on period start, close on period end) × (1 − discount)
 *
 * where the period runs from the previous boundary date to the purchase date. The "lower of
 * the two dates" rule (a look-back provision) is why a falling share price still produces a
 * good entry: the earlier, higher price is discarded.
 */

/** Every boundary date in `(from, through]`, in chronological order. */
export function esppPurchaseDates(
  boundaries: { month: number; day: number }[],
  from: string,
  through: string,
): DayString[] {
  if (!boundaries.length) return [];
  const start = toDay(from);
  const end = toDay(through);
  const sorted = [...boundaries].sort((a, b) => a.month - b.month || a.day - b.day);

  const out: DayString[] = [];
  for (let year = yearOf(start) - 1; year <= yearOf(end) + 1; year++) {
    for (const boundary of sorted) {
      const day = makeDay(year, boundary.month, boundary.day);
      if (day > start && day <= end) out.push(day);
    }
  }
  return out.sort();
}

/** The boundary immediately preceding `purchaseDate` — the start of its accumulation period. */
export function esppPeriodStart(
  boundaries: { month: number; day: number }[],
  purchaseDate: string,
): DayString {
  const target = toDay(purchaseDate);
  const sorted = [...boundaries].sort((a, b) => a.month - b.month || a.day - b.day);
  const candidates: DayString[] = [];
  for (const year of [yearOf(target) - 1, yearOf(target)]) {
    for (const boundary of sorted) {
      candidates.push(makeDay(year, boundary.month, boundary.day));
    }
  }
  const previous = candidates.filter((d) => d < target).sort();
  return previous[previous.length - 1] ?? addYears(target, -1);
}

/**
 * The close on or immediately before `day`. Returns undefined when history does not reach
 * back that far, which makes the caller fall back to the current price and flag the grant as
 * modelled (constitution principle VI).
 */
export function closeOnOrBefore(
  points: StockPricePoint[],
  day: string,
): number | undefined {
  const target = toDay(day);
  let best: StockPricePoint | undefined;
  for (const point of points) {
    const pointDay = toDay(point.date);
    if (pointDay <= target && (!best || pointDay > toDay(best.date))) best = point;
  }
  return best?.closeCents;
}

export interface EsppProjectionInput {
  plan: EsppPlan;
  today: string;
  /** Project purchases up to and including this date. */
  through: string;
  /** Daily closes, used to resolve boundary prices that are already in the past. */
  history: StockPricePoint[];
  /** Stand-in for any boundary price that has not happened yet. */
  currentPricePerShareCents: number;
  /** Used to value the projected shares. Falls back to the current price. */
  effectiveTargetPerShareCents?: number;
}

export function projectEspp(input: EsppProjectionInput): EsppProjection {
  const { plan, today, through, history, currentPricePerShareCents } = input;
  const discount = Math.min(Math.max(plan.discountPct, 0), 0.95);
  const grants: ProjectedEsppGrant[] = [];

  for (const purchaseDate of esppPurchaseDates(plan.periodBoundaries, today, through)) {
    const periodStart = esppPeriodStart(plan.periodBoundaries, purchaseDate);
    const startClose = closeOnOrBefore(history, periodStart);
    // The period end is in the future for every projected grant, so its price is always
    // modelled; only the period start can be a real close.
    const startPrice = startClose ?? currentPricePerShareCents;
    const endPrice = currentPricePerShareCents;
    const modelled = startClose == null;

    const referencePriceCents = Math.min(startPrice, endPrice);
    if (referencePriceCents <= 0) continue;

    const purchasePriceCents = Math.max(1, scaleCents(referencePriceCents, 1 - discount));
    const estimatedShares = plan.contributionPerPeriodCents / purchasePriceCents;

    grants.push({
      purchaseDate,
      periodStart,
      periodEnd: purchaseDate,
      contributionCents: plan.contributionPerPeriodCents,
      referencePriceCents,
      purchasePriceCents,
      estimatedShares,
      discountValueCents: Math.round(estimatedShares * (referencePriceCents - purchasePriceCents)),
      basis:
        `${startClose != null ? `Actual close on ${formatDay(periodStart)}` : `Current price used for ${formatDay(periodStart)}`}` +
        ` vs current price for ${formatDay(purchaseDate)}; lower of the two, less ${(discount * 100).toFixed(0)}% discount.`,
      modelled,
    });
  }

  const totalEstimatedShares = grants.reduce((sum, g) => sum + g.estimatedShares, 0);
  const totalContributionCents = grants.reduce((sum, g) => sum + g.contributionCents, 0);
  const valuationPerShare = input.effectiveTargetPerShareCents ?? currentPricePerShareCents;

  return {
    symbol: plan.symbol,
    through: toDay(through),
    grants,
    totalEstimatedShares,
    totalContributionCents,
    valueAtTargetCents: Math.round(totalEstimatedShares * valuationPerShare),
    assumptions: [
      `${(plan.contributionPerPeriodCents / 100).toFixed(0)} ${plan.currency} contributed per six-month period.`,
      `Purchase price is the lower of the two boundary closes, less ${(discount * 100).toFixed(0)}%.`,
      'Future boundary prices are unknown, so the current price stands in for them.',
      input.effectiveTargetPerShareCents
        ? 'Projected shares are valued at the effective target price.'
        : 'Projected shares are valued at the current market price.',
    ],
  };
}

/** The next purchase date and its estimated shares, for the dashboard card. */
export function nextEsppGrant(
  projection: EsppProjection,
): { date: DayString; estimatedShares: number } | undefined {
  const first = projection.grants[0];
  return first ? { date: first.purchaseDate, estimatedShares: first.estimatedShares } : undefined;
}
