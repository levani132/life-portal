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

  @Prop({ default: 'USD' })
  displayCurrency!: string;

  @Prop({ default: 7, min: 1, max: 31 })
  salaryDayOfMonth!: number;

  /** Applied to modelled stock-sale proceeds. Georgia taxes most personal share sales at 0%. */
  @Prop({ default: 0, min: 0, max: 1 })
  capitalGainsTaxRate!: number;

  @Prop({ type: Object, default: {} })
  fxRates!: Record<string, number>;

  @Prop()
  fxRatesUpdatedAt?: string;
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
  fxRates?: Record<string, number>;
}

export const DEFAULT_SETTINGS = {
  displayCurrency: 'USD',
  salaryDayOfMonth: 7,
  capitalGainsTaxRate: 0,
  fxRates: {} as Record<string, number>,
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
