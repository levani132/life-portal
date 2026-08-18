import type {
  StockFundamentals,
  StockPricePoint,
  SuggestedTarget,
  TargetPriceComponent,
} from '@life-portal/shared-types';
import { diffDays, toDay } from './dates';

/**
 * Suggested target price.
 *
 * This is a deliberately simple, fully transparent blend of four anchors rather than a
 * valuation model. It exists to answer "what is a defensible price to sell at?" and every
 * term it uses is returned alongside the answer so the UI can show the maths (constitution
 * principle VI). It is not investment advice and the code says so in the `basis` string.
 *
 * The four anchors, and why each is here:
 *
 * 1. **52-week high** — the stock has demonstrably traded there within a year, so reclaiming
 *    it needs no new thesis. Anchors the target in observed reality.
 * 2. **Damped drift** — the annualised return over available history, halved and clamped,
 *    extrapolated across the horizon. Trends persist somewhat but mean-revert, hence the
 *    damping; without it a momentum stock produces a fantasy number.
 * 3. **P/E reversion** — trailing EPS times a peer-median P/E, grown by expected EPS growth.
 *    The only fundamentals-based term; it pulls the target down when a stock is expensive
 *    relative to its sector and up when it is cheap.
 * 4. **Cost-basis hurdle** — the user's average cost plus a required annual return. This is
 *    not a market signal; it encodes "selling below this is not worth doing", which matters
 *    when the sale is funding a debt repayment.
 *
 * Missing inputs drop their term and the remaining weights renormalise, so a symbol with no
 * fundamentals still gets a usable suggestion at lower confidence.
 */

/** Base weights. Renormalised across whichever components are actually available. */
const BASE_WEIGHTS = {
  fifty_two_week_high: 0.3,
  drift: 0.3,
  pe_reversion: 0.3,
  cost_basis_hurdle: 0.1,
} as const;

/** Annualised drift is halved before extrapolation, then clamped to this band. */
const DRIFT_DAMPING = 0.5;
const DRIFT_MIN = -0.25;
const DRIFT_MAX = 0.35;

/** Required annual return over cost basis for the hurdle term. */
const COST_BASIS_HURDLE_ANNUAL = 0.15;

/** The blend is clamped to this band around the current price to absorb bad inputs. */
const FLOOR_MULTIPLE = 0.85;
const CAP_MULTIPLE = 2.5;

/** Minimum history span before drift is considered meaningful. */
const MIN_DRIFT_DAYS = 90;

export interface SuggestedTargetInput {
  symbol: string;
  currentPricePerShareCents: number;
  horizonMonths: number;
  fiftyTwoWeekHighCents?: number;
  history?: StockPricePoint[];
  fundamentals?: StockFundamentals;
  /** The user's average cost per share across unsold lots. */
  averageCostPerShareCents?: number;
}

/** Annualised return implied by the first and last points of the history window. */
export function annualisedDrift(history: StockPricePoint[]): number | undefined {
  if (!history || history.length < 2) return undefined;
  const sorted = [...history].sort((a, b) => (toDay(a.date) < toDay(b.date) ? -1 : 1));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first.closeCents <= 0 || last.closeCents <= 0) return undefined;

  const days = diffDays(first.date, last.date);
  if (days < MIN_DRIFT_DAYS) return undefined;

  const years = days / 365.25;
  return Math.pow(last.closeCents / first.closeCents, 1 / years) - 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function suggestTargetPrice(input: SuggestedTargetInput): SuggestedTarget | undefined {
  const current = input.currentPricePerShareCents;
  if (!current || current <= 0) return undefined;

  const horizonMonths = Math.max(1, input.horizonMonths);
  const horizonYears = horizonMonths / 12;
  const components: TargetPriceComponent[] = [];

  if (input.fiftyTwoWeekHighCents && input.fiftyTwoWeekHighCents > 0) {
    components.push({
      key: 'fifty_two_week_high',
      label: '52-week high',
      valueCents: input.fiftyTwoWeekHighCents,
      weight: BASE_WEIGHTS.fifty_two_week_high,
      basis: 'The stock traded here within the last year, so it needs no new thesis to return.',
    });
  }

  const rawDrift = input.history ? annualisedDrift(input.history) : undefined;
  if (rawDrift != null) {
    const damped = clamp(rawDrift * DRIFT_DAMPING, DRIFT_MIN, DRIFT_MAX);
    components.push({
      key: 'drift',
      label: 'Trend extrapolation',
      valueCents: Math.round(current * (1 + damped * horizonYears)),
      weight: BASE_WEIGHTS.drift,
      basis:
        `Historic return of ${(rawDrift * 100).toFixed(1)}% a year, halved to ` +
        `${(damped * 100).toFixed(1)}% for mean reversion, applied over ${horizonMonths} months.`,
    });
  }

  const eps = input.fundamentals?.epsTtm;
  const peerPe = input.fundamentals?.peerPe ?? input.fundamentals?.peTtm;
  if (eps && eps > 0 && peerPe && peerPe > 0) {
    const growth = input.fundamentals?.epsGrowthPct
      ? clamp(input.fundamentals.epsGrowthPct / 100, -0.3, 0.5)
      : 0;
    const forwardEps = eps * (1 + growth * horizonYears);
    components.push({
      key: 'pe_reversion',
      label: 'P/E reversion',
      valueCents: Math.round(forwardEps * peerPe * 100),
      weight: BASE_WEIGHTS.pe_reversion,
      basis:
        `Trailing EPS of ${eps.toFixed(2)}${growth ? ` grown ${(growth * 100).toFixed(0)}%/yr` : ''} ` +
        `at a ${peerPe.toFixed(1)}× multiple.`,
    });
  }

  if (input.averageCostPerShareCents && input.averageCostPerShareCents > 0) {
    components.push({
      key: 'cost_basis_hurdle',
      label: 'Cost-basis hurdle',
      valueCents: Math.round(
        input.averageCostPerShareCents * (1 + COST_BASIS_HURDLE_ANNUAL * horizonYears),
      ),
      weight: BASE_WEIGHTS.cost_basis_hurdle,
      basis:
        `Average cost plus ${(COST_BASIS_HURDLE_ANNUAL * 100).toFixed(0)}% a year — ` +
        'the minimum that makes selling worthwhile.',
    });
  }

  if (!components.length) return undefined;

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const normalised = components.map((c) => ({ ...c, weight: c.weight / totalWeight }));
  const blended = normalised.reduce((sum, c) => sum + c.valueCents * c.weight, 0);

  const floorCents = Math.round(current * FLOOR_MULTIPLE);
  const capCents = Math.round(current * CAP_MULTIPLE);
  const valueCents = Math.round(clamp(blended, floorCents, capCents));
  const clamped = Math.round(blended) !== valueCents;

  const hasFundamentals = normalised.some((c) => c.key === 'pe_reversion');
  const confidence: SuggestedTarget['confidence'] =
    normalised.length >= 3 && hasFundamentals ? 'high' : normalised.length >= 2 ? 'medium' : 'low';

  return {
    symbol: input.symbol,
    value: valueCents,
    horizonMonths,
    components: normalised,
    upsidePct: valueCents / current - 1,
    floorCents,
    capCents,
    confidence,
    basis:
      `Weighted blend of ${normalised.length} anchor${normalised.length === 1 ? '' : 's'} ` +
      `(${normalised.map((c) => c.label.toLowerCase()).join(', ')}) over a ${horizonMonths}-month horizon` +
      `${clamped ? ', clamped to the sanity band around the current price' : ''}. ` +
      'A heuristic for deciding when to sell, not investment advice.',
    assumptions: {
      currentPriceCents: current,
      horizonMonths,
      componentCount: normalised.length,
      clamped,
      ...(rawDrift != null ? { historicAnnualReturnPct: Number((rawDrift * 100).toFixed(2)) } : {}),
      ...(peerPe ? { peerPe: Number(peerPe.toFixed(2)) } : {}),
    },
  };
}
