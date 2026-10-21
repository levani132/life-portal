import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Put,
  ForbiddenException,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  ValidateIf,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AUDIENCES,
  MODULE_IDS,
  type Audience,
  type ModuleId,
  type PortalPreferences,
  type PortalState,
} from '@life-portal/shared-types';
import {
  privateModuleVisibility,
  selectedAvailableModules,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { NutritionModule } from '../nutrition/nutrition.module';
import { NutritionService } from '../nutrition/nutrition.service';
import { SettingsModule, SettingsService } from '../settings/settings.module';

class VisibilityDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(AUDIENCES)
  nutrition?: Audience;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(AUDIENCES)
  money?: Audience;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(AUDIENCES)
  stocks?: Audience;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(AUDIENCES)
  loans?: Audience;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(AUDIENCES)
  items?: Audience;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(AUDIENCES)
  personal?: Audience;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(AUDIENCES)
  projects?: Audience;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['private'])
  epam?: Audience;
}
export class PortalPreferencesDto implements PortalPreferences {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(8)
  @IsIn(MODULE_IDS, { each: true })
  selectedModules?: ModuleId[];
  @ValidateIf((_, value: unknown) => value !== undefined)
  @ValidateNested()
  @Type(() => VisibilityDto)
  moduleVisibility?: VisibilityDto;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(64)
  @Matches(/^[a-z0-9]{1,32}(:[a-z0-9_-]{1,64})?$/i, { each: true })
  widgetOrder?: string[];
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(3)
  setupStep?: number;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  setupCompleted?: boolean;
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  setupDismissed?: boolean;
}
@Injectable()
export class PortalService {
  constructor(
    private readonly settings: SettingsService,
    private readonly access: AccessService,
    private readonly nutrition: NutritionService,
  ) {}
  async get(userId: string): Promise<PortalState> {
    // Owned, idempotent field migration; no history or nutrition facts are rewritten.
    await this.nutrition.ensurePrivateSharing(userId);
    const [settings, identity] = await Promise.all([
      this.settings.get(userId),
      this.access.forUser(userId),
    ]);
    if (settings.selectedModules === undefined) {
      await this.settings.initializeModules(
        userId,
        selectedAvailableModules(undefined, identity.access),
      );
    }
    return {
      ...identity,
      selectedModules: selectedAvailableModules(
        settings.selectedModules,
        identity.access,
      ),
      moduleVisibility: {
        ...privateModuleVisibility(),
        ...settings.moduleVisibility,
        epam: 'private',
      },
      widgetOrder: settings.widgetOrder,
      setupStep: settings.setupStep ?? 0,
      setupCompleted: settings.setupCompleted ?? false,
      setupDismissed: settings.setupDismissed ?? false,
    };
  }
  async update(userId: string, dto: PortalPreferencesDto) {
    const current = await this.get(userId);
    if (dto.selectedModules?.some((id) => !current.access[id]))
      throw new ForbiddenException('A selected module is not available.');
    const stored = await this.settings.get(userId);
    const patch = {
      ...dto,
      ...(dto.selectedModules
        ? {
            selectedModules: [
              ...dto.selectedModules,
              ...(stored.selectedModules ?? []).filter(
                (id) => !current.access[id],
              ),
            ],
          }
        : {}),
      ...(dto.moduleVisibility
        ? {
            moduleVisibility: {
              ...current.moduleVisibility,
              ...dto.moduleVisibility,
            },
          }
        : {}),
    };
    await this.settings.setPortalPreferences(userId, patch);
    return this.get(userId);
  }
}
@Controller('portal')
class PortalController {
  constructor(private readonly portal: PortalService) {}
  @Get() get(@CurrentUser('userId') userId: string) {
    return this.portal.get(userId);
  }
  @Put() update(
    @CurrentUser('userId') userId: string,
    @Body() dto: PortalPreferencesDto,
  ) {
    return this.portal.update(userId, dto);
  }
}
@Module({
  imports: [SettingsModule, NutritionModule],
  providers: [PortalService],
  controllers: [PortalController],
  exports: [PortalService],
})
export class PortalModule {}
