import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Model } from 'mongoose';
import type { Currency, FxContext, ItemsSummary, SellableItem as SellableItemDto } from '@life-portal/shared-types';
import { ITEM_STATUSES, SUPPORTED_CURRENCIES } from '@life-portal/shared-types';
import { itemsProceedsForLoan, summariseItems } from '@life-portal/shared-domain';
import { baseSchemaOptions, dayField, requiredCentsField, centsField } from '../common/mongoose';
import { OwnedCrudService } from '../common/owned-crud.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Today } from '../common/today';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ schema

@Schema({ _id: false })
export class ItemListingSub {
  @Prop({ required: true }) platform!: string;
  @Prop() url?: string;
  @Prop({ required: true, match: DAY }) listedAt!: string;
  @Prop(centsField) priceCents?: number;
}

@Schema({ _id: false })
export class BuyerInterestSub {
  @Prop({ required: true }) name!: string;
  @Prop() contact?: string;
  @Prop(centsField) offeredPriceCents?: number;
  @Prop({ required: true, match: DAY }) at!: string;
  @Prop() note?: string;
  @Prop({ enum: ['open', 'negotiating', 'lost', 'won'], default: 'open' }) status!: string;
}

@Schema({ ...baseSchemaOptions, collection: 'sellable_items' })
export class SellableItem {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop() description?: string;
  @Prop() category?: string;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' }) currency!: string;
  @Prop(requiredCentsField) askingPriceCents!: number;
  /** What projections use: the realistic price after haggling. */
  @Prop(requiredCentsField) expectedPriceCents!: number;
  @Prop(centsField) minPriceCents?: number;
  @Prop({ required: true, enum: ITEM_STATUSES, default: 'draft', index: true }) status!: string;
  @Prop({ enum: ['new', 'like_new', 'good', 'fair', 'poor'] }) condition?: string;
  @Prop({ type: [SchemaFactory.createForClass(ItemListingSub)], default: [] }) listings!: ItemListingSub[];
  @Prop({ type: [SchemaFactory.createForClass(BuyerInterestSub)], default: [] }) interests!: BuyerInterestSub[];
  @Prop(centsField) soldPriceCents?: number;
  @Prop(dayField) soldAt?: string;
  @Prop({ index: true }) allocateToLoanId?: string;
  @Prop({ default: 1, min: 0, max: 1 }) allocationRatio!: number;
  @Prop(dayField) expectedSaleDate?: string;
  @Prop() photoUrl?: string;
  @Prop() notes?: string;
}

export const SellableItemSchema = SchemaFactory.createForClass(SellableItem);

// ------------------------------------------------------------------ dto

export class ItemListingDto {
  @IsString() @MaxLength(60) platform!: string;
  @IsOptional() @IsUrl() url?: string;
  @Matches(DAY) listedAt!: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
}

export class BuyerInterestDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(200) contact?: string;
  @IsOptional() @IsInt() @Min(0) offeredPriceCents?: number;
  @Matches(DAY) at!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsIn(['open', 'negotiating', 'lost', 'won']) status?: string;
}

export class CreateItemDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsIn(SUPPORTED_CURRENCIES) currency?: string;
  @IsInt() @Min(0) askingPriceCents!: number;
  @IsOptional() @IsInt() @Min(0) expectedPriceCents?: number;
  @IsOptional() @IsInt() @Min(0) minPriceCents?: number;
  @IsOptional() @IsIn(ITEM_STATUSES) status?: string;
  @IsOptional() @IsIn(['new', 'like_new', 'good', 'fair', 'poor']) condition?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ItemListingDto) listings?: ItemListingDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BuyerInterestDto) interests?: BuyerInterestDto[];
  @IsOptional() @IsInt() @Min(0) soldPriceCents?: number;
  @IsOptional() @Matches(DAY) soldAt?: string;
  @IsOptional() @IsMongoId() allocateToLoanId?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) allocationRatio?: number;
  @IsOptional() @Matches(DAY) expectedSaleDate?: string;
  @IsOptional() @IsUrl() photoUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateItemDto extends CreateItemDto {
  @IsOptional() @IsString() @MaxLength(160) override name!: string;
  @IsOptional() @IsInt() @Min(0) override askingPriceCents!: number;
}

export class MarkSoldDto {
  @IsInt() @Min(0) soldPriceCents!: number;
  @IsOptional() @Matches(DAY) soldAt?: string;
  /** Record the proceeds as a loan payment straight away. */
  @IsOptional() @IsMongoId() recordPaymentToLoanId?: string;
}

// ------------------------------------------------------------------ service

@Injectable()
export class ItemsService extends OwnedCrudService<SellableItem> {
  constructor(@InjectModel(SellableItem.name) model: Model<SellableItem>) {
    super(model, 'Item');
  }

  protected override defaultSort(): Record<string, 1 | -1> {
    return { status: 1, expectedPriceCents: -1 };
  }

  async list(userId: string, status?: string): Promise<SellableItemDto[]> {
    const rows = await this.model
      .find(this.scoped(userId, status ? { status } : {}))
      .sort(this.defaultSort());
    return rows.map((r) => r.toJSON() as unknown as SellableItemDto);
  }

  /**
   * A distinct name rather than an override of `create`, because the base signature accepts
   * any partial and this one requires a full DTO — narrowing a parameter would break
   * substitutability.
   */
  async createItem(userId: string, dto: CreateItemDto): Promise<SellableItemDto> {
    // Expected price defaults to the asking price so projections are never zero just because
    // the user has not thought about haggling yet.
    const created = await this.model.create({
      ...dto,
      expectedPriceCents: dto.expectedPriceCents ?? dto.askingPriceCents,
      userId,
    } as never);
    return this.serialize(created) as unknown as SellableItemDto;
  }

  async markSold(userId: string, id: string, dto: MarkSoldDto, today: string): Promise<SellableItemDto> {
    const updated = await this.update(userId, id, {
      status: 'sold',
      soldPriceCents: dto.soldPriceCents,
      soldAt: dto.soldAt ?? today,
    });
    return updated as unknown as SellableItemDto;
  }

  async summary(userId: string, currency: Currency = 'GEL', fx?: FxContext): Promise<ItemsSummary> {
    return summariseItems(await this.list(userId), currency, fx);
  }

  /** Proceeds earmarked for one loan, in all three price variants. */
  async proceedsForLoan(userId: string, loanId: string) {
    return itemsProceedsForLoan(await this.list(userId), loanId);
  }
}

// ------------------------------------------------------------------ controller

@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  async overview(@CurrentUser('userId') userId: string, @Query('status') status?: string) {
    const [items, summary] = await Promise.all([
      this.items.list(userId, status),
      this.items.summary(userId),
    ]);
    return { items, summary };
  }

  @Get('summary')
  summary(@CurrentUser('userId') userId: string) {
    return this.items.summary(userId);
  }

  @Get(':id')
  findOne(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.items.findOne(userId, id);
  }

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateItemDto) {
    return this.items.createItem(userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.items.update(userId, id, dto as Partial<SellableItem>);
  }

  @Post(':id/sold')
  markSold(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: MarkSoldDto,
    @Today() today: string,
  ) {
    return this.items.markSold(userId, id, dto, today);
  }

  @Delete(':id')
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.items.remove(userId, id);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: SellableItem.name, schema: SellableItemSchema }])],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
