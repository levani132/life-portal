import type { EsppPlan, StockPricePoint } from '@life-portal/shared-types';
import { closeOnOrBefore, esppPeriodStart, esppPurchaseDates, projectEspp } from './espp';

const EPAM_BOUNDARIES = [
  { month: 5, day: 1 },
  { month: 11, day: 1 },
];

const plan: EsppPlan = {
  id: 'espp1',
  userId: 'u1',
  symbol: 'EPAM',
  contributionPerPeriodCents: 288_000, // $2,880
  currency: 'USD',
  discountPct: 0.15,
  periodBoundaries: EPAM_BOUNDARIES,
  active: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('esppPurchaseDates', () => {
  it('lists the 1 May and 1 November boundaries ahead', () => {
    expect(esppPurchaseDates(EPAM_BOUNDARIES, '2026-08-03', '2027-12-31')).toEqual([
      '2026-11-01',
      '2027-05-01',
      '2027-11-01',
    ]);
  });

  it('excludes today itself and includes the horizon end', () => {
    expect(esppPurchaseDates(EPAM_BOUNDARIES, '2026-11-01', '2027-05-01')).toEqual(['2027-05-01']);
  });
});

describe('esppPeriodStart', () => {
  it('pairs a November purchase with the preceding May', () => {
    expect(esppPeriodStart(EPAM_BOUNDARIES, '2026-11-01')).toBe('2026-05-01');
  });

  it('pairs a May purchase with the preceding November', () => {
    expect(esppPeriodStart(EPAM_BOUNDARIES, '2027-05-01')).toBe('2026-11-01');
  });
});

describe('closeOnOrBefore', () => {
  const history: StockPricePoint[] = [
    { date: '2026-04-28', closeCents: 20_000 },
    { date: '2026-05-01', closeCents: 21_000 },
    { date: '2026-06-01', closeCents: 25_000 },
  ];

  it('returns the close on the exact day', () => {
    expect(closeOnOrBefore(history, '2026-05-01')).toBe(21_000);
  });

  it('falls back to the most recent earlier close for a market holiday', () => {
    expect(closeOnOrBefore(history, '2026-05-03')).toBe(21_000);
  });

  it('returns undefined before history begins', () => {
    expect(closeOnOrBefore(history, '2026-01-01')).toBeUndefined();
  });
});

describe('projectEspp', () => {
  const history: StockPricePoint[] = [{ date: '2026-05-01', closeCents: 20_000 }];

  it('buys at 15% off the lower of the two boundary prices', () => {
    // Period start 1 May closed at $200; the current price is $240, so the look-back keeps
    // the cheaper $200 reference and the purchase price is $170.
    const projection = projectEspp({
      plan,
      today: '2026-08-03',
      through: '2026-12-31',
      history,
      currentPricePerShareCents: 24_000,
    });

    expect(projection.grants).toHaveLength(1);
    const grant = projection.grants[0];
    expect(grant.purchaseDate).toBe('2026-11-01');
    expect(grant.periodStart).toBe('2026-05-01');
    expect(grant.referencePriceCents).toBe(20_000);
    expect(grant.purchasePriceCents).toBe(17_000);
    expect(grant.estimatedShares).toBeCloseTo(288_000 / 17_000, 6);
    expect(grant.modelled).toBe(false);
  });

  it('uses the current price when it is the lower of the two', () => {
    const projection = projectEspp({
      plan,
      today: '2026-08-03',
      through: '2026-12-31',
      history,
      currentPricePerShareCents: 16_000,
    });
    expect(projection.grants[0].referencePriceCents).toBe(16_000);
    expect(projection.grants[0].purchasePriceCents).toBe(13_600);
  });

  it('flags a grant as modelled when the boundary close is unknown', () => {
    const projection = projectEspp({
      plan,
      today: '2026-08-03',
      through: '2026-12-31',
      history: [],
      currentPricePerShareCents: 20_000,
    });
    expect(projection.grants[0].modelled).toBe(true);
    expect(projection.grants[0].basis).toContain('Current price used for');
  });

  it('accumulates shares and contributions across several periods', () => {
    const projection = projectEspp({
      plan,
      today: '2026-08-03',
      through: '2027-12-31',
      history,
      currentPricePerShareCents: 20_000,
    });
    expect(projection.grants).toHaveLength(3);
    expect(projection.totalContributionCents).toBe(864_000);
    expect(projection.totalEstimatedShares).toBeCloseTo(3 * (288_000 / 17_000), 6);
  });

  it('values projected shares at the target price when one is given', () => {
    const projection = projectEspp({
      plan,
      today: '2026-08-03',
      through: '2026-12-31',
      history,
      currentPricePerShareCents: 20_000,
      effectiveTargetPerShareCents: 30_000,
    });
    expect(projection.valueAtTargetCents).toBe(Math.round(projection.totalEstimatedShares * 30_000));
  });

  it('records the discount as immediate paper gain', () => {
    const projection = projectEspp({
      plan,
      today: '2026-08-03',
      through: '2026-12-31',
      history,
      currentPricePerShareCents: 20_000,
    });
    const grant = projection.grants[0];
    expect(grant.discountValueCents).toBe(
      Math.round(grant.estimatedShares * (grant.referencePriceCents - grant.purchasePriceCents)),
    );
  });
});
