import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Put,
} from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';
import { Model } from 'mongoose';
import { AccessService } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';

const SHORTCUT_URL = /^https:\/\/www\.icloud\.com\/shortcuts\/[a-f0-9]{32}$/i;
const SETTINGS_ID = 'apple-health';
@Schema({ collection: 'health_shortcut_settings', timestamps: true })
export class HealthShortcutSettings {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ required: true }) installationUrl!: string;
  @Prop({ required: true }) updatedBy!: string;
  updatedAt?: Date;
}
export const HealthShortcutSettingsSchema = SchemaFactory.createForClass(
  HealthShortcutSettings,
);
export class UpdateHealthShortcutDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  @Matches(SHORTCUT_URL)
  installationUrl!: string;
}
@Injectable()
export class HealthShortcutSettingsService {
  constructor(
    @InjectModel(HealthShortcutSettings.name)
    private readonly model: Model<HealthShortcutSettings>,
    private readonly access: AccessService,
  ) {}
  async getUrl() {
    const row = await this.model.findById(SETTINGS_ID).lean();
    return row?.installationUrl && SHORTCUT_URL.test(row.installationUrl)
      ? row.installationUrl
      : undefined;
  }
  async get(userId: string) {
    this.access.requireDeveloper(userId);
    return { installationUrl: (await this.getUrl()) ?? '' };
  }
  async update(userId: string, installationUrl: string) {
    this.access.requireDeveloper(userId);
    const url = installationUrl.trim();
    if (!SHORTCUT_URL.test(url))
      throw new BadRequestException(
        'Enter a valid iCloud Shortcut sharing link.',
      );
    await this.model.updateOne(
      { _id: SETTINGS_ID },
      {
        $set: { installationUrl: url, updatedBy: userId },
      },
      { upsert: true },
    );
    return { installationUrl: url };
  }
}
@Controller('settings/health-shortcut')
export class HealthShortcutSettingsController {
  constructor(private readonly settings: HealthShortcutSettingsService) {}
  @Get() get(@CurrentUser('userId') userId: string) {
    return this.settings.get(userId);
  }
  @Put() update(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateHealthShortcutDto,
  ) {
    return this.settings.update(userId, dto.installationUrl);
  }
}
