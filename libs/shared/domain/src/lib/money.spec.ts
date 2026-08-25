import { clampPositive, convertCents, formatCents, ratio, scaleCents, sumCents, toCents } from './money';

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
});
