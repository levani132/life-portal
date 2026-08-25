import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SUPPORTED_CURRENCIES } from '@life-portal/shared-types';
import { baseSchemaOptions, requiredDayField } from '../common/mongoose';

/**
 * One day's published rates.
 *
 * `rates` holds floats, not cents. An exchange rate is a ratio rather than a monetary
 * amount, and rounding it to two decimals would put visible error into every converted
 * figure — so principle II does not apply here. See `docs/DECISIONS.md`.
 */
@Schema({ _id: false })
export class FxRatePointSub {
  @Prop(requiredDayField) date!: string;

  @Prop({ type: Object, required: true }) rates!: Record<string, number>;
}

/**
 * The exchange-rate archive, one document per base currency.
 *
 * **Not owned by a user.** A published rate is a public fact, like a share price, so this
 * follows `stock_quotes`/`stock_price_history` in having no `userId` and no `scoped()` read.
 * It is the only other kind of collection in this codebase that is global rather than
 * per-owner, and nothing user-specific may ever be added to it.
 */
@Schema({ ...baseSchemaOptions, collection: 'fx_rate_history' })
export class FxRateHistory {
  @Prop({
    required: true,
    enum: SUPPORTED_CURRENCIES,
    unique: true,
    index: true,
  })
  base!: string;

  @Prop({ type: [SchemaFactory.createForClass(FxRatePointSub)], default: [] })
  points!: FxRatePointSub[];

  @Prop({ required: true }) fetchedAt!: string;
}

export const FxRateHistorySchema = SchemaFactory.createForClass(FxRateHistory);
