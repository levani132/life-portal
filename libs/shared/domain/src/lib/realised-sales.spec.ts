import type { SellableItem, StockLot } from '@life-portal/shared-types';
import { realisedSales, saleFromItem, saleFromStockLot, salesOnDay } from './realised-sales';

const item: SellableItem = {
  id: 'item1',
  userId: 'u1',
  name: 'MacBook Pro',
  currency: 'USD',
  askingPriceCents: 100_000,
  expectedPriceCents: 90_000,
  status: 'sold',
  listings: [],
  interests: [],
  soldPriceCents: 85_000,
  soldAt: '2026-08-12',
  allocationRatio: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-08-12',
};

const lot: StockLot = {
  id: 'lot1',
  userId: 'u1',
  symbol: 'EPAM',
  quantity: 10,
  pricePerShareCents: 15_000,
  currency: 'USD',
  purchaseDate: '2025-05-01',
  source: 'purchase',
  soldQuantity: 4,
  soldPricePerShareCents: 20_000,
  soldAt: '2026-08-20',
  allocationRatio: 1,
  createdAt: '2025-05-01',
  updatedAt: '2026-08-20',
};

describe('saleFromItem', () => {
  it('turns a sold item into the cash it produced', () => {
    expect(saleFromItem(item)).toEqual({
      id: 'item1',
      label: 'MacBook Pro',
      amountCents: 85_000,
      grossCents: 85_000,
      currency: 'USD',
      date: '2026-08-12',
      source: 'item',
      allocatedToLoanId: undefined,
    });
  });

  it('ignores items that have not actually sold', () => {
    expect(saleFromItem({ ...item, status: 'reserved' })).toBeUndefined();
    expect(saleFromItem({ ...item, soldAt: undefined })).toBeUndefined();
    expect(saleFromItem({ ...item, soldPriceCents: undefined })).toBeUndefined();
    // A giveaway is not cash.
    expect(saleFromItem({ ...item, soldPriceCents: 0 })).toBeUndefined();
  });

  it('excludes the share earmarked for a debt', () => {
    // Half of $850 goes to the loan, so only $425 reaches the account.
    expect(saleFromItem({ ...item, allocateToLoanId: 'loan1', allocationRatio: 0.5 })).toMatchObject(
      { amountCents: 42_500, grossCents: 85_000, allocatedToLoanId: 'loan1' },
    );
    // Fully earmarked: none of it is spendable cash.
    expect(saleFromItem({ ...item, allocateToLoanId: 'loan1' })).toMatchObject({ amountCents: 0 });
  });

  it('clamps a nonsense allocation ratio instead of inverting the arithmetic', () => {
    expect(
      saleFromItem({ ...item, allocateToLoanId: 'loan1', allocationRatio: 1.4 }),
    ).toMatchObject({ amountCents: 0 });
    expect(
      saleFromItem({ ...item, allocateToLoanId: 'loan1', allocationRatio: -1 }),
    ).toMatchObject({ amountCents: 85_000 });
  });
});

describe('saleFromStockLot', () => {
  it('multiplies the sold quantity by the sale price', () => {
    expect(saleFromStockLot(lot)).toMatchObject({
      label: 'EPAM · 4 shares',
      amountCents: 80_000,
      grossCents: 80_000,
      date: '2026-08-20',
      source: 'stock',
    });
  });

  it('handles fractional shares and a single share', () => {
    expect(saleFromStockLot({ ...lot, soldQuantity: 1 })?.label).toBe('EPAM · 1 share');
    // 2.5 × $150.00 = $375.00, rounded to whole cents.
    expect(
      saleFromStockLot({ ...lot, soldQuantity: 2.5, soldPricePerShareCents: 15_001 })?.grossCents,
    ).toBe(37_503);
  });

  it('ignores lots that are still held', () => {
    expect(saleFromStockLot({ ...lot, soldQuantity: undefined })).toBeUndefined();
    expect(saleFromStockLot({ ...lot, soldAt: undefined })).toBeUndefined();
    expect(saleFromStockLot({ ...lot, soldPricePerShareCents: undefined })).toBeUndefined();
  });
});

describe('realisedSales', () => {
  it('merges both widgets oldest first', () => {
    expect(realisedSales({ items: [item], lots: [lot] }).map((sale) => sale.date)).toEqual([
      '2026-08-12',
      '2026-08-20',
    ]);
  });

  it('drops everything unsold and copes with missing inputs', () => {
    expect(realisedSales({ items: [{ ...item, status: 'listed' }] })).toEqual([]);
    expect(realisedSales({})).toEqual([]);
  });

  it('picks out one day', () => {
    const sales = realisedSales({ items: [item], lots: [lot] });
    expect(salesOnDay(sales, '2026-08-20').map((sale) => sale.source)).toEqual(['stock']);
    expect(salesOnDay(sales, '2026-08-13')).toEqual([]);
  });
});
