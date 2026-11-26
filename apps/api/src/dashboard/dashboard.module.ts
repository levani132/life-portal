import { Body, Controller, Get, Module, Put, Req } from '@nestjs/common';
import type { ProxiedRequest } from '../app/web-proxy';
import { ArrayMaxSize, IsArray, IsIn, IsObject, Matches, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { isPortalSize } from '@life-portal/shared-domain';
import { WIDGET_SIZES, type DashboardResponse, type PortalWidgetSize, type UserSettings, type WidgetSize } from '@life-portal/shared-types';
import { CurrentUser, Public } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import { BoardsModule } from '../boards/boards.module';
import { CashflowModule } from '../cashflow/cashflow.module';
import { ItemsModule } from '../items/items.module';
import { LoansModule } from '../loans/loans.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { PersonalModule } from '../personal/personal.module';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { FxModule } from '../fx/fx.module';
import { SpendingModule } from '../spending/spending.module';
import { StocksModule } from '../stocks/stocks.module';
import { TrainingModule } from '../training/training.module';
import { DashboardService } from './dashboard.service';

/**
 * The user's card arrangement: card ids in display order, following the `PUT .../order`
 * convention the boards module already uses for tasks.
 *
 * Bounded and pattern-checked so the field cannot be used as arbitrary storage — every id the
 * dashboard emits is `loans` or `board:epam` shaped. Unknown ids are not rejected: a client on
 * an older build may still know a card this deploy removed, and `arrangeWidgets` ignores them
 * rather than failing the whole write.
 */
export class WidgetOrderDto {
  @IsArray()
  @ArrayMaxSize(64)
  @Matches(/^[a-z0-9]{1,32}(:[a-z0-9_-]{1,64})?$/i, {
    each: true,
    message: 'order must contain dashboard card ids',
  })
  order!: string[];
}

const CARD_ID = /^[a-z0-9]{1,32}(:[a-z0-9_-]{1,64})?$/i;

/** At most 32 entries, each a module id with a portal size. */
@ValidatorConstraint({ name: 'portalSizes' })
class PortalSizes implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length <= 32 && entries.every(([id, size]) => /^[a-z]{2,32}$/.test(id) && isPortalSize(size));
  }
  defaultMessage() {
    return 'sizes must map module ids to a size in squares, like 4x2 (a one-wide widget is 1x1)';
  }
}

/** Spec 046: the portal's arrangement: module ids in order, and each one's size. */
export class PortalArrangementDto {
  @IsArray()
  @ArrayMaxSize(32)
  @Matches(/^[a-z]{2,32}$/, { each: true, message: 'order must contain module ids' })
  order!: string[];
  @IsObject()
  @Validate(PortalSizes)
  sizes!: Record<string, PortalWidgetSize>;
}

/** One card's width on Home. The id is pattern-checked like the order's, for the same reason. */
export class WidgetSizeDto {
  @Matches(CARD_ID, { message: 'id must be a dashboard card id' }) id!: string;
  @IsIn(WIDGET_SIZES) size!: WidgetSize;
}

@Controller()
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly settings: SettingsService,
  ) {}

  /** Every card and summary for the landing page, in one request. */
  @Get('dashboard')
  build(@CurrentUser('userId') userId: string, @Today() today: string): Promise<DashboardResponse> {
    return this.dashboard.build(userId, today);
  }

  /** Persists a rearrangement made by dragging the cards on the dashboard. */
  @Put('dashboard/order')
  async reorder(
    @CurrentUser('userId') userId: string,
    @Body() dto: WidgetOrderDto,
  ): Promise<{ order: UserSettings['widgetOrder'] }> {
    const settings = await this.settings.setWidgetOrder(userId, dto.order);
    return { order: settings.widgetOrder };
  }

  /** Spec 046: the portal's own order and sizes, written as one arrangement. */
  @Put('portal/arrangement')
  async arrangePortal(@CurrentUser('userId') userId: string, @Body() dto: PortalArrangementDto) {
    const settings = await this.settings.setPortalArrangement(userId, [...new Set(dto.order)], dto.sizes);
    return { order: settings.portalOrder ?? [], sizes: settings.portalSizes ?? {} };
  }

  /** Persists the width the person chose for one card. */
  @Put('dashboard/size')
  async resize(
    @CurrentUser('userId') userId: string,
    @Body() dto: WidgetSizeDto,
  ): Promise<{ sizes: NonNullable<UserSettings['widgetSizes']> }> {
    const settings = await this.settings.setWidgetSize(userId, dto.id, dto.size);
    return { sizes: settings.widgetSizes ?? {} };
  }

  /**
   * Unauthenticated liveness probe, so a free host's health check does not need a token.
   * `proxied` (issue #29) says whether this request came through the web app's own `/api` with a
   * valid proof, which is how the setup is checked after deploying.
   */
  @Public()
  @Get('health')
  health(@Req() req: ProxiedRequest) {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), proxied: req.viaWebProxy === true, proxy: req.proxyCheck };
  }
}

@Module({
  imports: [
    FxModule,
    SpendingModule,
    LoansModule,
    CashflowModule,
    ItemsModule,
    StocksModule,
    BoardsModule,
    PersonalModule,
    NutritionModule,
    TrainingModule,
    SettingsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
