import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { LOT_SOURCES, SUPPORTED_CURRENCIES } from '@life-portal/shared-types';
import {
  baseSchemaOptions,
  centsField,
  dayField,
  requiredCentsField,
  requiredDayField,
} from '../common/mongoose';

/**
 * One purchase. Buying the same symbol on three dates is three rows with three cost bases,
 * which is the only way "how much did I pay" stays answerable after a partial sale.
 */
@Schema({ ...baseSchemaOptions, collection: 'stock_lots' })
export class StockLot {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, uppercase: true, trim: true, index: true }) symbol!: string;
  /** Float: fractional shares are real, especially from an ESPP. */
  @Prop({ required: true, min: 0 }) quantity!: number;
  @Prop(requiredCentsField) pricePerShareCents!: number;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' }) currency!: string;
  @Prop(requiredDayField) purchaseDate!: string;
  @Prop({ required: true, enum: LOT_SOURCES, default: 'purchase' }) source!: string;
  @Prop({ min: 0, max: 1 }) discountPct?: number;
  @Prop(centsField) marketPriceAtPurchaseCents?: number;
  @Prop(centsField) feesCents?: number;
  @Prop({ min: 0 }) soldQuantity?: number;
  @Prop(centsField) soldPricePerShareCents?: number;
  @Prop(dayField) soldAt?: string;
  @Prop({ index: true }) allocateToLoanId?: string;
  @Prop({ default: 1, min: 0, max: 1 }) allocationRatio!: number;
  @Prop() notes?: string;
}

export const StockLotSchema = SchemaFactory.createForClass(StockLot);

/** Guards against selling more shares than the lot ever held. */
StockLotSchema.pre('validate', function () {
  const doc = this as unknown as StockLot;
  if (doc.soldQuantity != null && doc.soldQuantity > doc.quantity) {
    throw new Error('Cannot sell more shares than the lot contains.');
  }
});

/**
 * Latest known price. The only cache the constitution permits, so it carries `fetchedAt` and
 * a `stale` flag rather than pretending to be live.
 */
@Schema({ ...baseSchemaOptions, collection: 'stock_quotes' })
export class StockQuote {
  @Prop({ required: true, uppercase: true, trim: true, unique: true, index: true }) symbol!: string;
  @Prop(requiredCentsField) pricePerShareCents!: number;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' }) currency!: string;
  @Prop(centsField) previousClosePerShareCents?: number;
  @Prop() dayChangePct?: number;
  @Prop(centsField) fiftyTwoWeekHighCents?: number;
  @Prop(centsField) fiftyTwoWeekLowCents?: number;
  @Prop({ required: true }) fetchedAt!: string;
  @Prop({ required: true, enum: ['finnhub', 'manual'], default: 'manual' }) provider!: string;
  @Prop({ default: false }) stale!: boolean;
}

export const StockQuoteSchema = SchemaFactory.createForClass(StockQuote);

@Schema({ _id: false })
export class StockPricePointSub {
  @Prop({ required: true, match: /^\d{4}-\d{2}-\d{2}$/ }) date!: string;
  @Prop(requiredCentsField) closeCents!: number;
}

/**
 * Daily closes.
 *
 * Finnhub's free tier does not serve historical candles, so this collection is grown by
 * appending each day's refreshed quote. History therefore starts the day the app does, which
 * is enough for the drift term to become meaningful after a quarter. Backfilled points can
 * also be imported by hand.
 */
@Schema({ ...baseSchemaOptions, collection: 'stock_price_history' })
export class StockPriceHistory {
  @Prop({ required: true, uppercase: true, trim: true, unique: true, index: true }) symbol!: string;
  @Prop({ type: [SchemaFactory.createForClass(StockPricePointSub)], default: [] })
  points!: StockPricePointSub[];
  @Prop({ required: true }) fetchedAt!: string;
}

export const StockPriceHistorySchema = SchemaFactory.createForClass(StockPriceHistory);

/** Fundamentals for the P/E reversion term. Refreshed rarely; all fields optional. */
@Schema({ ...baseSchemaOptions, collection: 'stock_fundamentals' })
export class StockFundamentals {
  @Prop({ required: true, uppercase: true, trim: true, unique: true, index: true }) symbol!: string;
  @Prop() epsTtm?: number;
  @Prop() peTtm?: number;
  /** Median trailing P/E of the symbol's Finnhub peers — the reversion anchor. */
  @Prop() peerPe?: number;
  @Prop() epsGrowthPct?: number;
  @Prop() beta?: number;
  @Prop({ required: true }) fetchedAt!: string;
}

export const StockFundamentalsSchema = SchemaFactory.createForClass(StockFundamentals);

@Schema({ ...baseSchemaOptions, collection: 'stock_targets' })
export class StockTarget {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, uppercase: true, trim: true }) symbol!: string;
  @Prop(centsField) targetPriceCents?: number;
  @Prop({ default: 12, min: 1, max: 120 }) horizonMonths!: number;
  @Prop() rationale?: string;
  @Prop(centsField) stopPriceCents?: number;
}

export const StockTargetSchema = SchemaFactory.createForClass(StockTarget);
StockTargetSchema.index({ userId: 1, symbol: 1 }, { unique: true });

@Schema({ _id: false })
export class EsppBoundarySub {
  @Prop({ required: true, min: 1, max: 12 }) month!: number;
  @Prop({ required: true, min: 1, max: 31 }) day!: number;
}

/** EPAM's twice-yearly employee share purchase plan. */
@Schema({ ...baseSchemaOptions, collection: 'espp_plans' })
export class EsppPlan {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, uppercase: true, trim: true }) symbol!: string;
  @Prop(requiredCentsField) contributionPerPeriodCents!: number;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' }) currency!: string;
  @Prop({ required: true, min: 0, max: 0.95, default: 0.15 }) discountPct!: number;
  @Prop({ type: [SchemaFactory.createForClass(EsppBoundarySub)], default: [] })
  periodBoundaries!: EsppBoundarySub[];
  @Prop({ default: true }) active!: boolean;
  @Prop() notes?: string;
}

export const EsppPlanSchema = SchemaFactory.createForClass(EsppPlan);
