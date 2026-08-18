import type { StockPricePoint } from '@life-portal/shared-types';
import { annualisedDrift, suggestTargetPrice } from './target-price';

/** Two years of monthly closes rising from `from` to `to`. */
function rising(from: number, to: number): StockPricePoint[] {
  const points: StockPricePoint[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const year = 2024 + Math.floor(i / 12);
    const month = (i % 12) + 1;
    points.push({
      date: `${year}-${String(month).padStart(2, '0')}-01`,
      closeCents: Math.round(from + ((to - from) * i) / steps),
    });
  }
  return points;
}

describe('annualisedDrift', () => {
  it('measures a doubling over two years as about 41% a year', () => {
    const drift = annualisedDrift([
      { date: '2024-08-01', closeCents: 10_000 },
      { date: '2026-08-01', closeCents: 20_000 },
    ]);
    expect(drift).toBeCloseTo(0.4142, 3);
  });

  it('refuses to extrapolate from too little history', () => {
    expect(
      annualisedDrift([
        { date: '2026-07-01', closeCents: 10_000 },
        { date: '2026-08-01', closeCents: 12_000 },
      ]),
    ).toBeUndefined();
    expect(annualisedDrift([{ date: '2026-08-01', closeCents: 10_000 }])).toBeUndefined();
  });
});

describe('suggestTargetPrice', () => {
  it('returns undefined without a current price', () => {
    expect(suggestTargetPrice({ symbol: 'EPAM', currentPricePerShareCents: 0, horizonMonths: 12 })).toBeUndefined();
  });

  it('returns undefined when no anchor at all is available', () => {
    expect(
      suggestTargetPrice({ symbol: 'EPAM', currentPricePerShareCents: 20_000, horizonMonths: 12 }),
    ).toBeUndefined();
  });

  it('works from a 52-week high alone, at low confidence', () => {
    const result = suggestTargetPrice({
      symbol: 'EPAM',
      currentPricePerShareCents: 20_000,
      horizonMonths: 12,
      fiftyTwoWeekHighCents: 26_000,
    });
    expect(result?.components).toHaveLength(1);
    expect(result?.value).toBe(26_000);
    expect(result?.confidence).toBe('low');
  });

  it('renormalises weights so available components always sum to one', () => {
    const result = suggestTargetPrice({
      symbol: 'EPAM',
      currentPricePerShareCents: 20_000,
      horizonMonths: 12,
      fiftyTwoWeekHighCents: 26_000,
      averageCostPerShareCents: 18_000,
    });
    const total = result!.components.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('reaches high confidence with fundamentals plus two other anchors', () => {
    const result = suggestTargetPrice({
      symbol: 'EPAM',
      currentPricePerShareCents: 20_000,
      horizonMonths: 12,
      fiftyTwoWeekHighCents: 26_000,
      history: rising(15_000, 20_000),
      fundamentals: { symbol: 'EPAM', epsTtm: 10, peerPe: 22, fetchedAt: '2026-08-03' },
    });
    expect(result?.confidence).toBe('high');
    expect(result?.components.map((c) => c.key)).toEqual(
      expect.arrayContaining(['fifty_two_week_high', 'drift', 'pe_reversion']),
    );
  });

  it('damps momentum rather than extrapolating it whole', () => {
    const result = suggestTargetPrice({
      symbol: 'EPAM',
      currentPricePerShareCents: 20_000,
      horizonMonths: 12,
      history: rising(10_000, 20_000),
    });
    const drift = result!.components.find((c) => c.key === 'drift')!;
    // Raw drift is ~41%/yr; halved and clamped to 35% max, so at most $270 not $282.
    expect(drift.valueCents).toBeLessThan(28_200);
    expect(drift.basis).toContain('halved');
  });

  it('clamps an absurd fundamentals input into the sanity band', () => {
    const result = suggestTargetPrice({
      symbol: 'BROKEN',
      currentPricePerShareCents: 10_000,
      horizonMonths: 12,
      fundamentals: { symbol: 'BROKEN', epsTtm: 500, peerPe: 90, fetchedAt: '2026-08-03' },
    });
    expect(result?.value).toBe(result?.capCents);
    expect(result?.assumptions?.['clamped']).toBe(true);
    expect(result?.basis).toContain('clamped');
  });

  it('exposes every input so the UI can show the maths', () => {
    const result = suggestTargetPrice({
      symbol: 'EPAM',
      currentPricePerShareCents: 20_000,
      horizonMonths: 18,
      fiftyTwoWeekHighCents: 26_000,
      averageCostPerShareCents: 18_000,
    });
    expect(result?.horizonMonths).toBe(18);
    expect(result?.components.every((c) => c.basis.length > 0)).toBe(true);
    expect(result?.basis).toContain('not investment advice');
    expect(result?.upsidePct).toBeCloseTo(result!.value / 20_000 - 1, 10);
  });

  it('scales the cost-basis hurdle with the horizon', () => {
    const short = suggestTargetPrice({
      symbol: 'EPAM',
      currentPricePerShareCents: 20_000,
      horizonMonths: 12,
      averageCostPerShareCents: 18_000,
    });
    const long = suggestTargetPrice({
      symbol: 'EPAM',
      currentPricePerShareCents: 20_000,
      horizonMonths: 24,
      averageCostPerShareCents: 18_000,
    });
    const hurdle = (r: typeof short) => r!.components.find((c) => c.key === 'cost_basis_hurdle')!.valueCents;
    expect(hurdle(long)).toBeGreaterThan(hurdle(short));
  });
});
