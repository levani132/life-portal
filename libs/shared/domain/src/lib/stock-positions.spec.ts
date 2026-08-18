import type { StockLot, StockQuote, StockTarget, SuggestedTarget } from '@life-portal/shared-types';
import {
  earmarkedByLoan,
  foldPositions,
  liquidationValueCents,
  maxTargetHorizonMonths,
  openQuantity,
  realisedPnlCents,
} from './stock-positions';

const stamps = { createdAt: '2026-01-01', updatedAt: '2026-01-01' };

function lot(overrides: Partial<StockLot> = {}): StockLot {
  return {
    id: 'lot1',
    userId: 'u1',
    symbol: 'EPAM',
    quantity: 20,
    pricePerShareCents: 17_000,
    currency: 'USD',
    purchaseDate: '2026-05-01',
    source: 'espp',
    allocationRatio: 1,
    ...stamps,
    ...overrides,
  };
}

const quote: StockQuote = {
  id: 'q1',
  symbol: 'EPAM',
  pricePerShareCents: 20_000,
  currency: 'USD',
  fiftyTwoWeekHighCents: 26_000,
  fetchedAt: '2026-08-03',
  provider: 'manual',
  ...stamps,
};

const suggestion: SuggestedTarget = {
  symbol: 'EPAM',
  value: 24_387,
  horizonMonths: 12,
  components: [],
  upsidePct: 0.219,
  floorCents: 17_000,
  capCents: 50_000,
  basis: 'test',
};

describe('lot arithmetic', () => {
  it('counts only unsold shares', () => {
    expect(openQuantity(lot())).toBe(20);
    expect(openQuantity(lot({ soldQuantity: 5 }))).toBe(15);
    expect(openQuantity(lot({ soldQuantity: 20 }))).toBe(0);
  });

  it('banks profit on the sold portion only', () => {
    expect(realisedPnlCents(lot({ soldQuantity: 5, soldPricePerShareCents: 20_000 }))).toBe(15_000);
    expect(realisedPnlCents(lot())).toBe(0);
  });
});

describe('foldPositions', () => {
  it('averages cost across open lots only', () => {
    const positions = foldPositions({
      lots: [
        lot({ id: 'a', quantity: 10, pricePerShareCents: 10_000 }),
        lot({ id: 'b', quantity: 10, pricePerShareCents: 20_000 }),
      ],
      quotes: { EPAM: quote },
      targets: {},
      suggestions: {},
      defaultCurrency: 'USD',
    });
    expect(positions[0].quantity).toBe(20);
    expect(positions[0].averageCostPerShareCents).toBe(15_000);
  });

  it('excludes a fully sold lot from the average', () => {
    const positions = foldPositions({
      lots: [
        lot({ id: 'a', quantity: 10, pricePerShareCents: 10_000, soldQuantity: 10, soldPricePerShareCents: 12_000 }),
        lot({ id: 'b', quantity: 10, pricePerShareCents: 20_000 }),
      ],
      quotes: { EPAM: quote },
      targets: {},
      suggestions: {},
      defaultCurrency: 'USD',
    });
    expect(positions[0].quantity).toBe(10);
    expect(positions[0].averageCostPerShareCents).toBe(20_000);
    expect(positions[0].realisedPnlCents).toBe(20_000);
  });

  it('groups the same symbol bought on different dates into one position', () => {
    const positions = foldPositions({
      lots: [lot({ id: 'a', purchaseDate: '2025-11-01' }), lot({ id: 'b', purchaseDate: '2026-05-01' })],
      quotes: { EPAM: quote },
      targets: {},
      suggestions: {},
      defaultCurrency: 'USD',
    });
    expect(positions).toHaveLength(1);
    expect(positions[0].lots).toHaveLength(2);
  });

  it('reports no market value when there is no quote', () => {
    const positions = foldPositions({
      lots: [lot()],
      quotes: {},
      targets: {},
      suggestions: {},
      defaultCurrency: 'USD',
    });
    expect(positions[0].marketValueCents).toBeUndefined();
    expect(positions[0].unrealisedPnlCents).toBeUndefined();
  });

  describe('effective target price', () => {
    const fold = (target?: StockTarget) =>
      foldPositions({
        lots: [lot()],
        quotes: { EPAM: quote },
        targets: target ? { EPAM: target } : {},
        suggestions: { EPAM: suggestion },
        defaultCurrency: 'USD',
      })[0];

    it("prefers the user's own target", () => {
      const position = fold({ id: 't', userId: 'u1', symbol: 'EPAM', targetPriceCents: 30_000, horizonMonths: 12, ...stamps });
      expect(position.effectiveTargetPerShareCents).toBe(30_000);
      expect(position.effectiveTargetIsSuggested).toBe(false);
      expect(position.valueAtTargetCents).toBe(600_000);
    });

    it('falls back to the suggestion when no target row exists', () => {
      const position = fold();
      expect(position.effectiveTargetPerShareCents).toBe(24_387);
      expect(position.effectiveTargetIsSuggested).toBe(true);
    });

    it('treats a target row carrying only a horizon as "not set"', () => {
      // The regression this guards: a `StockTarget` with no price used to arrive as
      // `targetPriceCents: 0` from the schema default, and `0 ?? suggestion` is `0` — which
      // silently discarded the suggestion and zeroed every "value at target" figure.
      const position = fold({ id: 't', userId: 'u1', symbol: 'EPAM', horizonMonths: 12, ...stamps });
      expect(position.effectiveTargetPerShareCents).toBe(24_387);
      expect(position.effectiveTargetIsSuggested).toBe(true);
      expect(position.valueAtTargetCents).toBeGreaterThan(0);
    });

    it('treats an explicit zero target the same way', () => {
      const position = fold({ id: 't', userId: 'u1', symbol: 'EPAM', targetPriceCents: 0, horizonMonths: 12, ...stamps });
      expect(position.effectiveTargetPerShareCents).toBe(24_387);
    });
  });
});

describe('liquidation', () => {
  const positions = () =>
    foldPositions({
      lots: [lot()],
      quotes: { EPAM: quote },
      targets: {},
      suggestions: { EPAM: suggestion },
      defaultCurrency: 'USD',
    });

  it('returns gross proceeds when no tax is modelled', () => {
    expect(liquidationValueCents({ positions: positions(), taxRate: 0, atTarget: false })).toBe(400_000);
  });

  it('taxes the gain only, not the whole proceeds', () => {
    // 20 × $200 = $4,000 gross, cost $3,400, gain $600, 20% tax = $120 → $3,880.
    expect(liquidationValueCents({ positions: positions(), taxRate: 0.2, atTarget: false })).toBe(388_000);
  });

  it('values at target when asked', () => {
    expect(liquidationValueCents({ positions: positions(), taxRate: 0, atTarget: true })).toBe(20 * 24_387);
  });

  it('charges no tax on a loss', () => {
    const losing = foldPositions({
      lots: [lot({ pricePerShareCents: 30_000 })],
      quotes: { EPAM: quote },
      targets: {},
      suggestions: {},
      defaultCurrency: 'USD',
    });
    expect(liquidationValueCents({ positions: losing, taxRate: 0.2, atTarget: false })).toBe(400_000);
  });
});

describe('earmarkedByLoan', () => {
  it('attributes a lot to its loan', () => {
    const positions = foldPositions({
      lots: [lot({ allocateToLoanId: 'loan1' })],
      quotes: { EPAM: quote },
      targets: {},
      suggestions: { EPAM: suggestion },
      defaultCurrency: 'USD',
    });
    expect(earmarkedByLoan(positions, { taxRate: 0, atTarget: false })).toEqual({ loan1: 400_000 });
  });

  it('splits by allocation ratio', () => {
    const positions = foldPositions({
      lots: [lot({ allocateToLoanId: 'loan1', allocationRatio: 0.5 })],
      quotes: { EPAM: quote },
      targets: {},
      suggestions: {},
      defaultCurrency: 'USD',
    });
    expect(earmarkedByLoan(positions, { taxRate: 0, atTarget: false })).toEqual({ loan1: 200_000 });
  });

  it('ignores unallocated lots', () => {
    const positions = foldPositions({
      lots: [lot()],
      quotes: { EPAM: quote },
      targets: {},
      suggestions: {},
      defaultCurrency: 'USD',
    });
    expect(earmarkedByLoan(positions, { taxRate: 0, atTarget: false })).toEqual({});
  });
});

describe('maxTargetHorizonMonths', () => {
  it('takes the longest user horizon, else the fallback', () => {
    const withTarget = foldPositions({
      lots: [lot()],
      quotes: { EPAM: quote },
      targets: { EPAM: { id: 't', userId: 'u1', symbol: 'EPAM', horizonMonths: 24, ...stamps } },
      suggestions: {},
      defaultCurrency: 'USD',
    });
    expect(maxTargetHorizonMonths(withTarget)).toBe(24);
    expect(maxTargetHorizonMonths([], 12)).toBe(12);
  });
});
