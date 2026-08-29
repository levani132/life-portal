import { Body, Controller, Get, Injectable, Module, Put } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Model } from 'mongoose';
import type { UserSettings as UserSettingsDto } from '@life-portal/shared-types';
import { SUPPORTED_CURRENCIES } from '@life-portal/shared-types';
import { baseSchemaOptions } from '../common/mongoose';
import { CurrentUser } from '../auth/current-user.decorator';

@Schema({ ...baseSchemaOptions, collection: 'user_settings' })
export class UserSettings {
  @Prop({ required: true, index: true, unique: true })
  userId!: string;

  /**
   * The currency every figure is *rendered* in. Amounts keep the currency they were
   * recorded in; this only decides what they are converted to on the way out, so changing
   * it never rewrites data (`libs/shared/domain/src/lib/fx.ts`).
   */
  @Prop({ default: 'GEL' })
  displayCurrency!: string;

  @Prop({ default: 7, min: 1, max: 31 })
  salaryDayOfMonth!: number;

  /** 0 = Sunday .. 6 = Saturday. A week is a real budgeting boundary, so it has to be explicit. */
  @Prop({ default: 1, min: 0, max: 6 })
  weekStartsOn!: number;

  /**
   * The day a *financial* month begins, which need not be the 1st.
   *
   * A budget month that resets before the salary arrives reports an allowance the account cannot
   * fund — with money landing on the 7th, a month starting on the 1st leaves six days each month
   * where the app and the bank disagree. Defaults to 1, which is ordinary calendar months.
   *
   * Capped at 28 so every month has the day.
   */
  @Prop({ default: 1, min: 1, max: 28 })
  monthStartsOn!: number;

  /**
   * Budgeted expense ids in the order the spending ladder fills them.
   *
   * A list of *preferences*, not positions — the same shape as `widgetOrder`, and for the same
   * reason: expenses are created and deleted, so this has to tolerate ids it has never seen and
   * ids that no longer exist.
   */
  @Prop({ type: [String], default: [] })
  spendOrder!: string[];

  /** Applied to modelled stock-sale proceeds. Georgia taxes most personal share sales at 0%. */
  @Prop({ default: 0, min: 0, max: 1 })
  capitalGainsTaxRate!: number;

  @Prop({ type: Object, default: {} })
  fxRates!: Record<string, number>;

  @Prop()
  fxRatesUpdatedAt?: string;

  /**
   * Dashboard card ids in the order the user dragged them into. A list of *preferences*, not
   * positions: cards are derived on every read, so this has to tolerate ids that no longer
   * exist and cards it has never seen (`arrangeWidgets` in `libs/shared/domain`).
   */
  @Prop({ type: [String], default: [] })
  widgetOrder!: string[];
}

export const UserSettingsSchema = SchemaFactory.createForClass(UserSettings);

export class UpdateSettingsDto {
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  displayCurrency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  salaryDayOfMonth?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  capitalGainsTaxRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekStartsOn?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  monthStartsOn?: number;

  @IsOptional()
  fxRates?: Record<string, number>;
}

export const DEFAULT_SETTINGS = {
  displayCurrency: 'GEL',
  salaryDayOfMonth: 7,
  capitalGainsTaxRate: 0,
  weekStartsOn: 1,
  monthStartsOn: 1,
  fxRates: {} as Record<string, number>,
  widgetOrder: [] as string[],
  spendOrder: [] as string[],
};

@Injectable()
export class SettingsService {
  constructor(@InjectModel(UserSettings.name) private readonly model: Model<UserSettings>) {}

  /**
   * Settings are created on first read rather than at registration, so a user seeded
   * directly into Mongo still gets sane defaults.
   */
  async get(userId: string): Promise<UserSettingsDto> {
    const found = await this.model.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, ...DEFAULT_SETTINGS } },
      { new: true, upsert: true },
    );
    return found.toJSON() as unknown as UserSettingsDto;
  }

  async update(userId: string, dto: UpdateSettingsDto): Promise<UserSettingsDto> {
    const patch: Record<string, unknown> = { ...dto };
    if (dto.fxRates) patch['fxRatesUpdatedAt'] = new Date().toISOString().slice(0, 10);
    return this.write(userId, patch);
  }

  /**
   * The dashboard arrangement, written by `PUT /dashboard/order`. Its own method rather than a
   * field on `UpdateSettingsDto`, so the rearrange gesture has exactly one writer and cannot
   * arrive bundled with a currency change.
   */
  setWidgetOrder(userId: string, widgetOrder: string[]): Promise<UserSettingsDto> {
    return this.write(userId, { widgetOrder });
  }

  /**
   * The order the spending ladder fills its rungs, written by `PUT /api/spending/order`.
   *
   * Its own method for the same reason `setWidgetOrder` has one: reordering the ladder has exactly
   * one writer and cannot arrive bundled with a currency change.
   */
  setSpendOrder(userId: string, spendOrder: string[]): Promise<UserSettingsDto> {
    return this.write(userId, { spendOrder });
  }

  private async write(userId: string, patch: Record<string, unknown>): Promise<UserSettingsDto> {
    // Upserting with the defaults means a first-ever write does not need a prior read — but a
    // path may not appear in `$set` and `$setOnInsert` at once: Mongo answers the whole update
    // with `ConflictingUpdateOperators` (a 500), so only untouched fields get a default.
    const seed = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS).filter(([field]) => !(field in patch)),
    );
    const updated = await this.model.findOneAndUpdate(
      { userId },
      { $set: patch, $setOnInsert: { userId, ...seed } },
      { new: true, upsert: true },
    );
    return updated.toJSON() as unknown as UserSettingsDto;
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@CurrentUser('userId') userId: string) {
    return this.settings.get(userId);
  }

  @Put()
  update(@CurrentUser('userId') userId: string, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(userId, dto);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: UserSettings.name, schema: UserSettingsSchema }])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
