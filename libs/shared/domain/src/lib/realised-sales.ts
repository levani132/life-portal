import type { RealisedSale, SellableItem, StockLot } from '@life-portal/shared-types';
import { toDay } from './dates';

/**
 * Turns things that have been sold into the cash they produced.
 *
 * Nothing here is persisted (constitution principle III): the item row and the lot row already
 * record what was sold, for how much, and on what day, so the inflow is derived from them on
 * every read. That also means correcting a sale price corrects the cashflow at the same time.
 *
 * **Earmarked proceeds are excluded.** When a sale is allocated to a debt, the loan widget
 * already counts that money against the balance owed; counting it as spendable cash as well
 * would let the same dollar do two jobs (constitution principle IV). Only the unearmarked share
 * reaches the account, so only that share becomes a cash event.
 */

/** Clamps a stored ratio into `[0, 1]` so a bad row cannot invert the arithmetic. */
function earmarkedRatio(allocateToLoanId: string | undefined, allocationRatio: number | undefined): number {
  if (!allocateToLoanId) return 0;
  const ratio = allocationRatio ?? 1;
  if (!Number.isFinite(ratio)) return 1;
  return Math.min(1, Math.max(0, ratio));
}

function netOf(grossCents: number, allocateToLoanId?: string, allocationRatio?: number): number {
  const earmarked = Math.round(grossCents * earmarkedRatio(allocateToLoanId, allocationRatio));
  return grossCents - earmarked;
}

/** The cash a sold item produced, or `undefined` while it is still unsold. */
export function saleFromItem(item: SellableItem): RealisedSale | undefined {
  if (item.status !== 'sold' || !item.soldAt) return undefined;
  const grossCents = item.soldPriceCents ?? 0;
  if (grossCents <= 0) return undefined;
  return {
    id: item.id,
    label: item.name,
    amountCents: netOf(grossCents, item.allocateToLoanId, item.allocationRatio),
    grossCents,
    currency: item.currency,
    date: toDay(item.soldAt),
    source: 'item',
    allocatedToLoanId: item.allocateToLoanId,
  };
}

/**
 * The cash a liquidated lot produced. Gross proceeds only — a sale price is what hit the
 * broker, and capital-gains tax is settled separately (0% on personal share sales in Georgia,
 * which is what the stocks widget assumes by default).
 */
export function saleFromStockLot(lot: StockLot): RealisedSale | undefined {
  if (!lot.soldAt || !lot.soldQuantity || lot.soldPricePerShareCents == null) return undefined;
  const grossCents = Math.round(lot.soldQuantity * lot.soldPricePerShareCents);
  if (grossCents <= 0) return undefined;
  return {
    id: lot.id,
    label: `${lot.symbol} · ${lot.soldQuantity} ${lot.soldQuantity === 1 ? 'share' : 'shares'}`,
    amountCents: netOf(grossCents, lot.allocateToLoanId, lot.allocationRatio),
    grossCents,
    currency: lot.currency,
    date: toDay(lot.soldAt),
    source: 'stock',
    allocatedToLoanId: lot.allocateToLoanId,
  };
}

/** Every realised sale across both widgets, oldest first. */
export function realisedSales(input: {
  items?: SellableItem[];
  lots?: StockLot[];
}): RealisedSale[] {
  const sales = [
    ...(input.items ?? []).map(saleFromItem),
    ...(input.lots ?? []).map(saleFromStockLot),
  ].filter((sale): sale is RealisedSale => sale != null);

  return sales.sort((a, b) => (a.date === b.date ? a.label.localeCompare(b.label) : a.date < b.date ? -1 : 1));
}

/** The sales that landed on one specific day. */
export function salesOnDay(sales: RealisedSale[], date: string): RealisedSale[] {
  const day = toDay(date);
  return sales.filter((sale) => sale.date === day);
}
