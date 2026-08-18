import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LOT_SOURCES, SUPPORTED_CURRENCIES } from '@life-portal/shared-types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL = /^[A-Za-z.-]{1,12}$/;

export class CreateLotDto {
  @Matches(SYMBOL, { message: 'Symbol must be 1-12 letters, e.g. EPAM' })
  symbol!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsInt()
  @Min(0)
  pricePerShareCents!: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @Matches(DAY)
  purchaseDate!: string;

  @IsOptional()
  @IsIn(LOT_SOURCES)
  source?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  discountPct?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  marketPriceAtPurchaseCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  feesCents?: number;

  /** Which loan the sale proceeds are earmarked for. */
  @IsOptional()
  @IsMongoId()
  allocateToLoanId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  allocationRatio?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateLotDto extends CreateLotDto {
  @IsOptional() @Matches(SYMBOL) override symbol!: string;
  @IsOptional() @IsNumber() @Min(0.000001) override quantity!: number;
  @IsOptional() @IsInt() @Min(0) override pricePerShareCents!: number;
  @IsOptional() @Matches(DAY) override purchaseDate!: string;
}

export class SellLotDto {
  @IsInt()
  @Min(0)
  pricePerShareCents!: number;

  /** Omit to sell the whole remaining lot. */
  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  quantity?: number;

  @IsOptional()
  @Matches(DAY)
  soldAt?: string;
}

export class UpsertTargetDto {
  @Matches(SYMBOL)
  symbol!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  targetPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  horizonMonths?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rationale?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  stopPriceCents?: number;
}

export class SetManualQuoteDto {
  @Matches(SYMBOL)
  symbol!: string;

  @IsInt()
  @Min(0)
  pricePerShareCents!: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fiftyTwoWeekHighCents?: number;
}

export class EsppBoundaryDto {
  @IsInt() @Min(1) @Max(12) month!: number;
  @IsInt() @Min(1) @Max(31) day!: number;
}

export class UpsertEsppPlanDto {
  @Matches(SYMBOL)
  symbol!: string;

  @IsInt()
  @Min(0)
  contributionPerPeriodCents!: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.95)
  discountPct?: number;

  /** Defaults to 1 May and 1 November, EPAM's boundaries. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EsppBoundaryDto)
  periodBoundaries?: EsppBoundaryDto[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class HistoryPointDto {
  @Matches(DAY) date!: string;
  @IsInt() @Min(0) closeCents!: number;
}

export class ImportHistoryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HistoryPointDto)
  points!: HistoryPointDto[];
}
