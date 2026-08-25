import type { FxRateHistory } from '@life-portal/shared-types';
import { canConvert, fxBasis, fxContext, rateTable, ratePointFor, sumInDisplay, toDisplayCents } from './fx';

/** Real NBG publications: 1 USD = 2.6121 GEL, 1 EUR = 3.0465 GEL on 2026-08-25. */
const history: FxRateHistory = {
  base: 'GEL',
  points: [
    { date: '2026-08-23', rates: { USD: 2.7, EUR: 3.1 } },
    { date: '2026-08-25', rates: { USD: 2.6121, EUR: 3.0465 } },
  ],
  fetchedAt: '2026-08-25',
};

describe('fx', () => {
  describe('ratePointFor', () => {
    it('uses the most recent publication on or before the day', () => {
      expect(ratePointFor(history, '2026-08-25')?.date).toBe('2026-08-25');
      expect(ratePointFor(history, '2026-08-24')?.date).toBe('2026-08-23');
      expect(ratePointFor(history, '2026-09-30')?.date).toBe('2026-08-25');
    });

    it('does not extrapolate backwards before the archive starts', () => {
      // Valuing an older transaction at a rate that did not exist yet would make its
      // converted figure change every time the archive grew backwards.
      expect(ratePointFor(history, '2026-08-22')).toBeUndefined();
    });

    it('survives an empty or missing archive', () => {
      expect(ratePointFor(null, '2026-08-25')).toBeUndefined();
      expect(ratePointFor({ base: 'GEL', points: [], fetchedAt: '2026-08-25' }, '2026-08-25')).toBeUndefined();
    });
  });

  describe('rateTable', () => {
    const table = rateTable('GEL', { USD: 2.6121, EUR: 3.0465 });

    it('quotes the base against every currency, both ways round', () => {
      expect(table['USD_GEL']).toBeCloseTo(2.6121, 6);
      expect(table['GEL_USD']).toBeCloseTo(1 / 2.6121, 6);
    });

    it('derives the cross rate so no caller rounds twice', () => {
      expect(table['USD_EUR']).toBeCloseTo(2.6121 / 3.0465, 6);
      expect(table['EUR_USD']).toBeCloseTo(3.0465 / 2.6121, 6);
    });

    it('never quotes a currency against itself', () => {
      expect(table['GEL_GEL']).toBeUndefined();
    });

    it('ignores a zero or negative rate rather than producing an infinity', () => {
      const broken = rateTable('GEL', { USD: 0, EUR: 3.0465 });
      expect(broken['USD_GEL']).toBeUndefined();
      expect(broken['EUR_GEL']).toBeCloseTo(3.0465, 6);
    });
  });

  describe('toDisplayCents', () => {
    const fx = fxContext(history, '2026-08-25', 'GEL');

    it('converts a foreign amount at that day rate', () => {
      // The $10 breakfast budget, in the currency the payments actually arrive in.
      expect(toDisplayCents(1000, 'USD', fx)).toEqual({ cents: 2612, currency: 'GEL', converted: true });
    });

    it('reports no conversion when the amount is already in the display currency', () => {
      expect(toDisplayCents(695, 'GEL', fx)).toEqual({ cents: 695, currency: 'GEL', converted: false });
    });

    it('hands back the original amount when no rate is known', () => {
      const bare = fxContext(null, '2026-08-25', 'GEL');
      expect(toDisplayCents(1000, 'USD', bare)).toEqual({ cents: 1000, currency: 'USD', converted: false });
      expect(canConvert('USD', bare)).toBe(false);
    });
  });

  describe('sumInDisplay', () => {
    const fx = fxContext(history, '2026-08-25', 'GEL');

    it('adds mixed currencies in the display currency', () => {
      const { cents, unconverted } = sumInDisplay(
        [
          { amountCents: 1000, currency: 'USD' },
          { amountCents: 695, currency: 'GEL' },
        ],
        fx,
      );
      expect(cents).toBe(2612 + 695);
      expect(unconverted).toEqual([]);
    });

    it('still counts an unconvertible amount, and names its currency', () => {
      // Understating a total is the more dangerous error, so the amount is kept and flagged.
      const bare = fxContext(null, '2026-08-25', 'GEL');
      const { cents, unconverted } = sumInDisplay(
        [
          { amountCents: 1000, currency: 'USD' },
          { amountCents: 695, currency: 'GEL' },
        ],
        bare,
      );
      expect(cents).toBe(1695);
      expect(unconverted).toEqual(['USD']);
    });

    it('ignores gaps in the list', () => {
      expect(sumInDisplay([null, undefined, { amountCents: 100, currency: 'GEL' }], fx).cents).toBe(100);
    });
  });

  it('keeps a past conversion stable when a newer rate is published', () => {
    // The property the whole design exists for: yesterday's figure must not move today.
    const before = toDisplayCents(1000, 'USD', fxContext(history, '2026-08-23', 'GEL'));
    const grown: FxRateHistory = {
      ...history,
      points: [...history.points, { date: '2026-08-26', rates: { USD: 9.99, EUR: 9.99 } }],
    };
    const after = toDisplayCents(1000, 'USD', fxContext(grown, '2026-08-23', 'GEL'));
    expect(after).toEqual(before);
    expect(after.cents).toBe(2700);
  });

  it('says which rate a converted figure came from', () => {
    const fx = fxContext(history, '2026-08-25', 'GEL');
    expect(fxBasis(fx)).toContain('2026-08-25');
    expect(fxBasis(fx, ['USD'])).toContain('USD');
    expect(fxBasis(fxContext(null, '2026-08-25', 'GEL'))).toContain('no exchange rate');
  });
});
