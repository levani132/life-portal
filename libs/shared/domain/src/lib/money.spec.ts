import {
  clampPositive,
  convertCents,
  formatCents,
  ratio,
  scaleCents,
  splitCentsEvenly,
  sumCents,
  toCents,
} from './money';

describe('money', () => {
  it('rounds to whole cents rather than carrying a fraction', () => {
    expect(toCents(10.005)).toBe(1001);
    expect(scaleCents(333, 1 / 3)).toBe(111);
    expect(scaleCents(1000, 2.6121)).toBe(2612);
  });

  it('treats missing amounts as zero when summing', () => {
    expect(sumCents([100, undefined, 200, null])).toBe(300);
  });

  it('clamps overpayment to fully repaid rather than negative', () => {
    expect(clampPositive(-500)).toBe(0);
    expect(ratio(1500, 1000)).toBe(1);
    expect(ratio(100, 0)).toBe(1);
  });

  it('drops decimals only when the amount is whole', () => {
    expect(formatCents(1050000, 'USD')).toBe('$10,500');
    expect(formatCents(1050050, 'USD')).toBe('$10,500.50');
    expect(formatCents(2612, 'GEL')).toBe('₾26.12');
  });

  describe('convertCents', () => {
    // 1 USD = 2.6121 GEL, 1 EUR = 3.0465 GEL (NBG, 2026-08-25).
    const rates = { USD_GEL: 2.6121, GEL_USD: 1 / 2.6121, EUR_GEL: 3.0465 };

    it('uses a direct rate when there is one', () => {
      expect(convertCents(1000, 'USD', 'GEL', rates)).toBe(2612);
    });

    it('inverts a rate quoted the other way round', () => {
      // No GEL_EUR entry, so it must invert EUR_GEL rather than give up.
      expect(convertCents(3047, 'GEL', 'EUR', rates)).toBe(1000);
    });

    it('is a no-op between the same currency', () => {
      expect(convertCents(1234, 'GEL', 'GEL', rates)).toBe(1234);
    });

    it('returns the amount untouched when no rate is known', () => {
      // The deliberate policy: an unconverted number is recoverable, a wrong one is not.
      expect(convertCents(1000, 'USD', 'JPY', rates)).toBe(1000);
      expect(convertCents(1000, 'USD', 'GEL', {})).toBe(1000);
    });

    it('ignores a zero rate instead of zeroing the amount', () => {
      // A rate table seeded with 0 must not silently destroy money.
      expect(convertCents(1000, 'USD', 'GEL', { USD_GEL: 0 })).toBe(1000);
    });
  });

  describe('splitCentsEvenly', () => {
    it('gives the indivisible remainder to the earliest parts', () => {
      // The worked example from research §13: ₾10.01 over three days.
      expect(splitCentsEvenly(1001, 3)).toEqual([334, 334, 333]);
    });

    it('divides evenly when it can', () => {
      expect(splitCentsEvenly(1000, 4)).toEqual([250, 250, 250, 250]);
      expect(splitCentsEvenly(0, 3)).toEqual([0, 0, 0]);
      expect(splitCentsEvenly(500, 1)).toEqual([500]);
    });

    it('spreads a remainder larger than one cent one cent at a time', () => {
      expect(splitCentsEvenly(7, 5)).toEqual([2, 2, 1, 1, 1]);
      // Less money than days: the early days get the cent, the late ones get nothing.
      expect(splitCentsEvenly(2, 5)).toEqual([1, 1, 0, 0, 0]);
    });

    it('always produces parts that sum back to the total exactly', () => {
      // The property is the whole point of the helper — no lost or invented tetri, for any
      // amount over any span. Exhaustive over a range wide enough to hit every remainder.
      for (let total = 0; total <= 400; total += 7) {
        for (let parts = 1; parts <= 31; parts += 1) {
          const split = splitCentsEvenly(total, parts);
          expect(split).toHaveLength(parts);
          expect(sumCents(split)).toBe(total);
          // Never more than a cent between the largest and the smallest part.
          expect(Math.max(...split) - Math.min(...split)).toBeLessThanOrEqual(
            1,
          );
        }
      }
    });

    it('returns no parts for a span of no days rather than inventing one', () => {
      expect(splitCentsEvenly(1000, 0)).toEqual([]);
      expect(splitCentsEvenly(1000, -3)).toEqual([]);
    });

    it('refuses a negative total rather than spreading a refund', () => {
      // A negative here means a caller has confused a repayment for spending; silence would
      // hide it, and this file exists to make rounding decisions explicit.
      expect(() => splitCentsEvenly(-100, 2)).toThrow(RangeError);
    });
  });
});
